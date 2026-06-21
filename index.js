const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { uploadToImgBB } = require("./utils/imgbb");

const app = express();
const port = process.env.PORT || 5000;

// Stripe is optional until keys are provided.
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Stripe webhook needs the raw body, so skip JSON parsing for that one route.
app.use((req, res, next) => {
  if (req.originalUrl === "/api/payments/webhook") return next();
  express.json({ limit: "10mb" })(req, res, next);
});

const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("PromptVerse API is running");
});

// JSON health check for uptime monitors and platform health probes
// (Railway/Render). Reports DB connectivity without leaking internals.
app.get("/health", async (req, res) => {
  try {
    await client.db("admin").command({ ping: 1 });
    res.json({ status: "ok", db: "connected", uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: "disconnected" });
  }
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB");

    const myDB = client.db("promptverse-db");
    const promptCollections = myDB.collection("prompts");
    const bookmarkCollections = myDB.collection("bookmarks");
    const reviewCollections = myDB.collection("reviews");
    const reportCollections = myDB.collection("reports");
    const paymentCollections = myDB.collection("payments");
    const userCollections = myDB.collection("user"); // better-auth users
    const sessionCollections = myDB.collection("session"); // better-auth sessions

    // Prevent duplicate bookmarks for the same user + prompt.
    await bookmarkCollections
      .createIndex({ userId: 1, promptId: 1 }, { unique: true })
      .catch(() => {});

    // ---------- Auth helpers ----------

    async function findUserById(userId) {
      let user = null;
      try {
        user = await userCollections.findOne({ _id: new ObjectId(userId) });
      } catch (_) {
        /* not an ObjectId */
      }
      if (!user) user = await userCollections.findOne({ id: userId });
      if (!user) user = await userCollections.findOne({ _id: userId });
      return user;
    }

    // Verifies a better-auth session token (issued via the bearer plugin) by
    // looking it up in the shared session collection. No better-auth on server.
    async function verifyToken(req, res, next) {
      try {
        const header = req.headers.authorization || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : null;
        if (!token) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        let session = await sessionCollections.findOne({ token });
        if (!session && token.includes(".")) {
          session = await sessionCollections.findOne({
            token: token.split(".")[0],
          });
        }
        if (!session) {
          return res.status(401).json({ message: "Invalid session" });
        }
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
          return res.status(401).json({ message: "Session expired" });
        }

        const user = await findUserById(session.userId);
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }

        req.user = {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          image: user.image || user.photoURL || null,
          role: user.role || "user",
          subscription: user.subscription || "free",
        };
        next();
      } catch (err) {
        console.error("verifyToken error", err);
        res.status(401).json({ message: "Unauthorized" });
      }
    }

    // Optional auth: attaches req.user if a valid token exists, else continues.
    async function optionalAuth(req, res, next) {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return next();
      try {
        let session = await sessionCollections.findOne({ token });
        if (!session && token.includes(".")) {
          session = await sessionCollections.findOne({
            token: token.split(".")[0],
          });
        }
        if (session) {
          const user = await findUserById(session.userId);
          if (user) {
            req.user = {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
              role: user.role || "user",
              subscription: user.subscription || "free",
            };
          }
        }
      } catch (_) {
        /* ignore */
      }
      next();
    }

    function requireRole(...roles) {
      return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
          return res.status(403).json({ message: "Forbidden" });
        }
        next();
      };
    }

    // ---------- Meta APIs (filter options) ----------

    app.get("/api/meta", (req, res) => {
      res.json({
        categories: [
          "Writing",
          "Coding",
          "Marketing",
          "Image Generation",
          "Productivity",
          "Education",
          "Business",
          "Design",
        ],
        aiTools: [
          "ChatGPT",
          "Gemini",
          "Claude",
          "Midjourney",
          "DALL-E",
          "Stable Diffusion",
          "Grok",
        ],
        difficulties: ["Beginner", "Intermediate", "Pro"],
      });
    });

    // ---------- Current user ----------

    app.get("/api/users/me", verifyToken, async (req, res) => {
      const totalPrompts = await promptCollections.countDocuments({
        creatorId: req.user.id,
      });
      res.json({ ...req.user, totalPrompts });
    });

    // ---------- Prompt APIs ----------

    // Public list with server-side search / filter / sort / pagination.
    // Includes premium (private) prompts so they show in the marketplace with
    // a Premium tag, but their `content` is never returned in listings.
    app.get("/api/prompts", async (req, res) => {
      const query = { status: "approved" };

      if (req.query.category) query.category = req.query.category;
      if (req.query.aiTool) query.aiTool = req.query.aiTool;
      if (req.query.difficulty) query.difficulty = req.query.difficulty;

      if (req.query.search) {
        const term = req.query.search.trim();
        query.$or = [
          { title: { $regex: term, $options: "i" } },
          { tags: { $regex: term, $options: "i" } },
          { aiTool: { $regex: term, $options: "i" } },
        ];
      }

      // Sorting
      let sort = { createdAt: -1 };
      if (req.query.sort === "popular") sort = { avgRating: -1, copyCount: -1 };
      else if (req.query.sort === "copied") sort = { copyCount: -1 };
      else if (req.query.sort === "latest") sort = { createdAt: -1 };

      // Pagination
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const limit = Math.max(parseInt(req.query.limit) || 9, 1);
      const skip = (page - 1) * limit;

      const total = await promptCollections.countDocuments(query);
      const prompts = await promptCollections
        .find(query, { projection: { content: 0 } })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.json({
        prompts,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    });

    // Featured / trending prompts (uses MongoDB limit).
    app.get("/api/prompts/featured", async (req, res) => {
      const limit = parseInt(req.query.limit) || 6;
      const prompts = await promptCollections
        .find({ status: "approved" }, { projection: { content: 0 } })
        .sort({ featured: -1, copyCount: -1, createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json(prompts);
    });

    // Current user's prompts.
    app.get("/api/my/prompts", verifyToken, async (req, res) => {
      const prompts = await promptCollections
        .find({ creatorId: req.user.id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(prompts);
    });

    // Single prompt with visibility / premium logic.
    app.get("/api/prompts/:id", optionalAuth, async (req, res) => {
      let prompt;
      try {
        prompt = await promptCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
      } catch (_) {
        return res.status(400).json({ message: "Invalid prompt id" });
      }
      if (!prompt) return res.status(404).json({ message: "Not found" });

      const user = req.user;
      const isPremium = user?.subscription === "premium";
      const isPrivileged =
        user?.role === "admin" ||
        user?.role === "creator" ||
        String(prompt.creatorId) === String(user?.id);

      const canViewFull =
        prompt.visibility === "public" || isPremium || isPrivileged;

      // Attach whether the current user bookmarked this prompt.
      let isBookmarked = false;
      if (user) {
        const bm = await bookmarkCollections.findOne({
          userId: user.id,
          promptId: req.params.id,
        });
        isBookmarked = !!bm;
      }

      if (!canViewFull) {
        return res.json({
          ...prompt,
          content: null,
          isLocked: true,
          canViewFull: false,
          isBookmarked,
        });
      }

      res.json({ ...prompt, isLocked: false, canViewFull: true, isBookmarked });
    });

    // Create a prompt (user/creator). New prompts are pending + copyCount 0.
    app.post("/api/prompts", verifyToken, async (req, res) => {
      // Free standard users may only add 3 prompts.
      if (req.user.role === "user" && req.user.subscription !== "premium") {
        const count = await promptCollections.countDocuments({
          creatorId: req.user.id,
        });
        if (count >= 3) {
          return res.status(403).json({
            message: "Free users can add up to 3 prompts. Upgrade to add more.",
          });
        }
      }

      const body = req.body || {};
      const prompt = {
        title: body.title,
        description: body.description,
        content: body.content,
        category: body.category,
        aiTool: body.aiTool,
        tags: Array.isArray(body.tags) ? body.tags : [],
        difficulty: body.difficulty || "Beginner",
        thumbnailUrl: body.thumbnailUrl || "",
        visibility: body.visibility === "private" ? "private" : "public",
        usageInstructions: body.usageInstructions || "",
        copyCount: 0,
        avgRating: 0,
        reviewCount: 0,
        status: "pending",
        featured: false,
        rejectionFeedback: "",
        creatorId: req.user.id,
        creatorName: req.user.name,
        creatorEmail: req.user.email,
        creatorImage: req.user.image || "",
        createdAt: new Date(),
      };

      const result = await promptCollections.insertOne(prompt);
      res.json({ insertedId: result.insertedId, ...prompt });
    });

    // Update own prompt (or admin). Edits reset status to pending.
    app.patch("/api/prompts/:id", verifyToken, async (req, res) => {
      let prompt;
      try {
        prompt = await promptCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
      } catch (_) {
        return res.status(400).json({ message: "Invalid prompt id" });
      }
      if (!prompt) return res.status(404).json({ message: "Not found" });

      const isOwner = String(prompt.creatorId) === String(req.user.id);
      if (!isOwner && req.user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      const body = req.body || {};
      const allowed = [
        "title",
        "description",
        "content",
        "category",
        "aiTool",
        "tags",
        "difficulty",
        "thumbnailUrl",
        "visibility",
        "usageInstructions",
      ];
      const update = {};
      allowed.forEach((key) => {
        if (body[key] !== undefined) update[key] = body[key];
      });
      // Owner edits go back to pending review (admins can edit freely).
      if (isOwner && req.user.role !== "admin") update.status = "pending";

      await promptCollections.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: update }
      );
      res.json({ message: "Prompt updated" });
    });

    // Delete own prompt (or admin).
    app.delete("/api/prompts/:id", verifyToken, async (req, res) => {
      let prompt;
      try {
        prompt = await promptCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
      } catch (_) {
        return res.status(400).json({ message: "Invalid prompt id" });
      }
      if (!prompt) return res.status(404).json({ message: "Not found" });

      const isOwner = String(prompt.creatorId) === String(req.user.id);
      if (!isOwner && req.user.role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      await promptCollections.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json({ message: "Prompt deleted" });
    });

    // Copy prompt — increments copy count (blocked for locked premium prompts).
    app.post("/api/prompts/:id/copy", verifyToken, async (req, res) => {
      let prompt;
      try {
        prompt = await promptCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
      } catch (_) {
        return res.status(400).json({ message: "Invalid prompt id" });
      }
      if (!prompt) return res.status(404).json({ message: "Not found" });

      const isPremium = req.user.subscription === "premium";
      const isPrivileged =
        req.user.role === "admin" ||
        req.user.role === "creator" ||
        String(prompt.creatorId) === String(req.user.id);
      if (prompt.visibility === "private" && !isPremium && !isPrivileged) {
        return res.status(403).json({ message: "Subscribe to premium to copy" });
      }

      await promptCollections.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $inc: { copyCount: 1 } }
      );
      res.json({ message: "Copied", content: prompt.content });
    });

    // ---------- Upload API (ImgBB) ----------

    app.post("/api/uploads/thumbnail", verifyToken, async (req, res) => {
      try {
        const { image } = req.body || {};
        if (!image) return res.status(400).json({ message: "No image provided" });
        const url = await uploadToImgBB(image);
        res.json({ url });
      } catch (err) {
        console.error("ImgBB upload error", err);
        res.status(500).json({ message: err.message || "Upload failed" });
      }
    });

    // ---------- Bookmark APIs ----------

    // Toggle bookmark (add if missing, remove if present).
    app.post("/api/bookmarks/:promptId", verifyToken, async (req, res) => {
      const promptId = req.params.promptId;
      const existing = await bookmarkCollections.findOne({
        userId: req.user.id,
        promptId,
      });

      if (existing) {
        await bookmarkCollections.deleteOne({ _id: existing._id });
        return res.json({ bookmarked: false, message: "Bookmark removed" });
      }

      await bookmarkCollections.insertOne({
        userId: req.user.id,
        promptId,
        createdAt: new Date(),
      });
      res.json({ bookmarked: true, message: "Prompt bookmarked" });
    });

    // List my bookmarked prompts (with prompt data).
    app.get("/api/bookmarks", verifyToken, async (req, res) => {
      const bookmarks = await bookmarkCollections
        .find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .toArray();

      const ids = bookmarks
        .map((b) => {
          try {
            return new ObjectId(b.promptId);
          } catch (_) {
            return null;
          }
        })
        .filter(Boolean);

      const prompts = await promptCollections
        .find({ _id: { $in: ids } })
        .toArray();

      res.json(prompts);
    });

    // ---------- Review APIs ----------

    app.post("/api/reviews", verifyToken, async (req, res) => {
      const { promptId, rating, comment } = req.body || {};
      if (!promptId || !rating) {
        return res.status(400).json({ message: "promptId and rating required" });
      }

      let prompt;
      try {
        prompt = await promptCollections.findOne({
          _id: new ObjectId(promptId),
        });
      } catch (_) {
        return res.status(400).json({ message: "Invalid prompt id" });
      }
      if (!prompt) return res.status(404).json({ message: "Prompt not found" });

      // Only users who can view the full prompt may review it.
      const isPremium = req.user.subscription === "premium";
      const isPrivileged =
        req.user.role === "admin" ||
        req.user.role === "creator" ||
        String(prompt.creatorId) === String(req.user.id);
      if (prompt.visibility === "private" && !isPremium && !isPrivileged) {
        return res
          .status(403)
          .json({ message: "Subscribe to premium to review" });
      }

      const review = {
        promptId,
        userId: req.user.id,
        name: req.user.name,
        email: req.user.email,
        image: req.user.image || "",
        rating: Number(rating),
        comment: comment || "",
        createdAt: new Date(),
      };
      await reviewCollections.insertOne(review);

      // Recompute prompt average rating.
      const agg = await reviewCollections
        .aggregate([
          { $match: { promptId } },
          {
            $group: {
              _id: "$promptId",
              avg: { $avg: "$rating" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();
      if (agg[0]) {
        await promptCollections.updateOne(
          { _id: new ObjectId(promptId) },
          { $set: { avgRating: agg[0].avg, reviewCount: agg[0].count } }
        );
      }

      res.json({ message: "Review added", review });
    });

    app.get("/api/reviews/prompt/:promptId", async (req, res) => {
      const reviews = await reviewCollections
        .find({ promptId: req.params.promptId })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(reviews);
    });

    app.get("/api/my/reviews", verifyToken, async (req, res) => {
      const reviews = await reviewCollections
        .find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(reviews);
    });

    // ---------- Report APIs ----------

    app.post("/api/reports", verifyToken, async (req, res) => {
      const { promptId, reason, description } = req.body || {};
      if (!promptId || !reason) {
        return res.status(400).json({ message: "promptId and reason required" });
      }
      const report = {
        promptId,
        reason,
        description: description || "",
        userId: req.user.id,
        reporterName: req.user.name,
        reporterEmail: req.user.email,
        status: "open",
        createdAt: new Date(),
      };
      await reportCollections.insertOne(report);
      res.json({ message: "Report submitted" });
    });

    // ---------- Home analytics (aggregation) ----------

    app.get("/api/home/top-creators", async (req, res) => {
      const limit = Math.max(parseInt(req.query.limit) || 5, 1);
      const topCreators = await promptCollections
        .aggregate([
          { $match: { status: "approved" } },
          {
            $group: {
              _id: "$creatorId",
              name: { $first: "$creatorName" },
              image: { $first: "$creatorImage" },
              totalPrompts: { $sum: 1 },
              totalCopies: { $sum: "$copyCount" },
            },
          },
          { $sort: { totalCopies: -1, totalPrompts: -1 } },
          { $limit: limit },
        ])
        .toArray();
      res.json(topCreators);
    });

    app.get("/api/home/reviews", async (req, res) => {
      const limit = Math.max(parseInt(req.query.limit) || 6, 1);
      const reviews = await reviewCollections
        .find({ comment: { $ne: "" } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      res.json(reviews);
    });

    // ---------- Creator analytics ----------

    app.get(
      "/api/creator/analytics",
      verifyToken,
      requireRole("creator", "admin"),
      async (req, res) => {
        const prompts = await promptCollections
          .find({ creatorId: req.user.id })
          .toArray();

        const totalPrompts = prompts.length;
        const totalCopies = prompts.reduce(
          (sum, p) => sum + (p.copyCount || 0),
          0
        );
        const promptIds = prompts.map((p) => p._id.toString());
        const totalBookmarks = await bookmarkCollections.countDocuments({
          promptId: { $in: promptIds },
        });

        // Copies per prompt (bar chart) + prompt growth by month (line chart).
        const copiesByPrompt = prompts
          .map((p) => ({ name: p.title?.slice(0, 16) || "Untitled", copies: p.copyCount || 0 }))
          .sort((a, b) => b.copies - a.copies)
          .slice(0, 8);

        const growthAgg = await promptCollections
          .aggregate([
            { $match: { creatorId: req.user.id } },
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m", date: "$createdAt" },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();
        const growth = growthAgg.map((g) => ({ month: g._id, count: g.count }));

        res.json({
          totalPrompts,
          totalCopies,
          totalBookmarks,
          copiesByPrompt,
          growth,
        });
      }
    );

    // ---------- Payment / Stripe APIs ----------

    app.post(
      "/api/payments/create-checkout-session",
      verifyToken,
      async (req, res) => {
        if (!stripe) {
          return res
            .status(503)
            .json({ message: "Stripe is not configured on the server" });
        }
        try {
          const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [
              {
                price_data: {
                  currency: "usd",
                  product_data: {
                    name: "PromptVerse Premium (Lifetime)",
                    description: "Unlock all premium prompts",
                  },
                  unit_amount: 500, // $5.00
                },
                quantity: 1,
              },
            ],
            customer_email: req.user.email,
            metadata: { userId: req.user.id, email: req.user.email },
            success_url: `${process.env.CLIENT_URL}/payment?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/payment?canceled=true`,
          });
          res.json({ id: session.id, url: session.url });
        } catch (err) {
          console.error("Stripe session error", err);
          res.status(500).json({ message: "Could not create checkout session" });
        }
      }
    );

    // Stripe webhook — raw body (registered without express.json above).
    app.post(
      "/api/payments/webhook",
      express.raw({ type: "application/json" }),
      async (req, res) => {
        if (!stripe) return res.status(503).end();
        let event;
        try {
          const sig = req.headers["stripe-signature"];
          event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
          );
        } catch (err) {
          console.error("Webhook signature error", err.message);
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const userId = session.metadata?.userId;
          await markPremium(userId, session);
        }
        res.json({ received: true });
      }
    );

    // Fallback confirm endpoint (used after redirect when no webhook is set up).
    app.post("/api/payments/confirm", verifyToken, async (req, res) => {
      const { sessionId } = req.body || {};
      let paymentInfo = { id: sessionId || `manual_${Date.now()}`, amount: 5 };

      if (stripe && sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.payment_status !== "paid") {
            return res.status(400).json({ message: "Payment not completed" });
          }
          paymentInfo = { id: session.id, amount: session.amount_total / 100 };
        } catch (_) {
          /* fall through to manual record */
        }
      }

      await markPremium(req.user.id, {
        id: paymentInfo.id,
        amount_total: paymentInfo.amount * 100,
        customer_email: req.user.email,
      });
      res.json({ message: "Premium activated" });
    });

    async function markPremium(userId, session) {
      if (!userId) return;
      const user = await findUserById(userId);
      if (!user) return;

      await userCollections.updateOne(
        { _id: user._id },
        { $set: { subscription: "premium" } }
      );

      const existing = await paymentCollections.findOne({
        transactionId: session.id,
      });
      if (!existing) {
        await paymentCollections.insertOne({
          userId,
          transactionId: session.id,
          email: session.customer_email || user.email,
          amount: (session.amount_total || 500) / 100,
          date: new Date(),
        });
      }
    }

    // ---------- Admin APIs ----------

    app.get(
      "/api/admin/users",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const users = await userCollections
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.json(users);
      }
    );

    app.patch(
      "/api/admin/users/:id/role",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const { role } = req.body || {};
        if (!["user", "creator", "admin"].includes(role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
        const user = await findUserById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found" });
        await userCollections.updateOne(
          { _id: user._id },
          { $set: { role } }
        );
        res.json({ message: "Role updated" });
      }
    );

    app.delete(
      "/api/admin/users/:id",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const user = await findUserById(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found" });
        await userCollections.deleteOne({ _id: user._id });
        res.json({ message: "User deleted" });
      }
    );

    app.get(
      "/api/admin/prompts",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const prompts = await promptCollections
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.json(prompts);
      }
    );

    app.patch(
      "/api/admin/prompts/:id/approve",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        await promptCollections.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "approved", rejectionFeedback: "" } }
        );
        res.json({ message: "Prompt approved" });
      }
    );

    app.patch(
      "/api/admin/prompts/:id/reject",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const { feedback } = req.body || {};
        if (!feedback) {
          return res
            .status(400)
            .json({ message: "Rejection feedback is required" });
        }
        await promptCollections.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "rejected", rejectionFeedback: feedback } }
        );
        res.json({ message: "Prompt rejected" });
      }
    );

    app.patch(
      "/api/admin/prompts/:id/feature",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const prompt = await promptCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
        await promptCollections.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { featured: !prompt?.featured } }
        );
        res.json({ message: "Prompt feature toggled" });
      }
    );

    app.delete(
      "/api/admin/prompts/:id",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        await promptCollections.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.json({ message: "Prompt deleted" });
      }
    );

    app.get(
      "/api/admin/payments",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const payments = await paymentCollections
          .find({})
          .sort({ date: -1 })
          .toArray();
        res.json(payments);
      }
    );

    app.get(
      "/api/admin/reports",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const reports = await reportCollections
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.json(reports);
      }
    );

    // Admin acts on a report: remove prompt / warn creator / dismiss.
    app.patch(
      "/api/admin/reports/:id",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const { action } = req.body || {};
        const report = await reportCollections.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!report) return res.status(404).json({ message: "Report not found" });

        if (action === "remove") {
          try {
            await promptCollections.deleteOne({
              _id: new ObjectId(report.promptId),
            });
          } catch (_) {
            /* ignore */
          }
          await reportCollections.updateOne(
            { _id: report._id },
            { $set: { status: "resolved-removed" } }
          );
        } else if (action === "warn") {
          await reportCollections.updateOne(
            { _id: report._id },
            { $set: { status: "creator-warned" } }
          );
        } else if (action === "dismiss") {
          await reportCollections.updateOne(
            { _id: report._id },
            { $set: { status: "dismissed" } }
          );
        }
        res.json({ message: "Report updated" });
      }
    );

    // Admin analytics (aggregation + counts).
    app.get(
      "/api/admin/analytics",
      verifyToken,
      requireRole("admin"),
      async (req, res) => {
        const totalUsers = await userCollections.countDocuments({});
        const totalPrompts = await promptCollections.countDocuments({});
        const totalReviews = await reviewCollections.countDocuments({});
        const copyAgg = await promptCollections
          .aggregate([
            { $group: { _id: null, total: { $sum: "$copyCount" } } },
          ])
          .toArray();
        const totalCopies = copyAgg[0]?.total || 0;

        const promptsByStatus = await promptCollections
          .aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ])
          .toArray();

        const promptsByCategory = await promptCollections
          .aggregate([
            { $match: { status: "approved" } },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray();

        res.json({
          totalUsers,
          totalPrompts,
          totalReviews,
          totalCopies,
          promptsByStatus: promptsByStatus.map((s) => ({
            status: s._id || "unknown",
            count: s.count,
          })),
          promptsByCategory: promptsByCategory.map((c) => ({
            category: c._id || "Other",
            count: c.count,
          })),
        });
      }
    );

    console.log("All routes registered");

    // Unknown routes -> consistent JSON 404 (registered after all routes).
    app.use((req, res) => {
      res.status(404).json({ message: "Route not found" });
    });
  } catch (err) {
    console.dir(err);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`PromptVerse API listening on port ${port}`);
});
