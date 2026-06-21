// Seeds the 3 demo accounts + sample prompts.
//
// Demo accounts are created through the better-auth sign-up endpoint on the
// Next.js client so passwords hash correctly, then their roles/subscriptions
// are set directly in MongoDB.
//
// Prerequisite: the Next.js client must be running (npm run dev) at CLIENT_URL.
//   1. cd promptverse-client && npm run dev
//   2. cd promptverse-server && npm run seed

require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const demoUsers = [
  {
    name: "Admin User",
    email: "admin@aiverse.com",
    password: "123456",
    role: "admin",
    subscription: "premium",
  },
  {
    name: "Creator User",
    email: "creator@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "premium",
  },
  {
    name: "Standard User",
    email: "user@aiverse.com",
    password: "123456",
    role: "user",
    subscription: "free",
  },
];

// Extra creators so the Top Creators section has variety. Each gets a few
// prompts seeded below so they surface in the aggregation. Images use pravatar
// (stable per id) and are written onto the user doc.
const extraCreators = [
  {
    name: "Sophia Chen",
    email: "sophia@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "premium",
    image: "https://i.pravatar.cc/150?img=5",
  },
  {
    name: "Marcus Reed",
    email: "marcus@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "free",
    image: "https://i.pravatar.cc/150?img=12",
  },
  {
    name: "Aisha Khan",
    email: "aisha@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "premium",
    image: "https://i.pravatar.cc/150?img=32",
  },
  {
    name: "Diego Santos",
    email: "diego@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "free",
    image: "https://i.pravatar.cc/150?img=15",
  },
  {
    name: "Emma Wilson",
    email: "emma@aiverse.com",
    password: "123456",
    role: "creator",
    subscription: "premium",
    image: "https://i.pravatar.cc/150?img=47",
  },
];

// Prompt templates assigned round-robin to extra creators.
const creatorPromptPool = [
  {
    title: "Viral Tweet Thread Builder",
    description: "Turn any idea into a high-engagement Twitter/X thread.",
    content:
      "Act as a viral content strategist. Turn [TOPIC] into a 7-tweet thread with a strong hook, punchy lines, and a CTA in the final tweet.",
    category: "Marketing",
    aiTool: "ChatGPT",
    tags: ["twitter", "social", "growth"],
    difficulty: "Beginner",
  },
  {
    title: "Python Bug Hunter",
    description: "Find and fix subtle bugs in your Python code.",
    content:
      "You are a senior Python engineer. Analyze the following code for bugs, edge cases, and performance issues, then provide a corrected version:\n\n[PASTE CODE]",
    category: "Coding",
    aiTool: "Claude",
    tags: ["python", "debugging", "code review"],
    difficulty: "Pro",
  },
  {
    title: "Logo Concept Generator",
    description: "Generate creative logo directions for any brand.",
    content:
      "minimalist logo for [BRAND], geometric, flat vector, 2-color palette, scalable, modern, on white background --v 6",
    category: "Design",
    aiTool: "Midjourney",
    tags: ["logo", "branding", "design"],
    difficulty: "Intermediate",
  },
  {
    title: "Weekly Meal Planner",
    description: "Create a balanced 7-day meal plan with a grocery list.",
    content:
      "Create a 7-day meal plan for [DIET/GOAL] with breakfast, lunch, dinner, and snacks. Include macros per meal and a consolidated grocery list.",
    category: "Productivity",
    aiTool: "Gemini",
    tags: ["health", "planning", "food"],
    difficulty: "Beginner",
  },
  {
    title: "Lesson Plan Architect",
    description: "Design an engaging lesson plan for any subject.",
    content:
      "Act as an instructional designer. Build a 60-minute lesson plan for [SUBJECT/GRADE] with objectives, activities, assessment, and differentiation strategies.",
    category: "Education",
    aiTool: "ChatGPT",
    tags: ["teaching", "lesson", "education"],
    difficulty: "Intermediate",
  },
  {
    title: "Product Launch Email",
    description: "Write a launch announcement email that converts.",
    content:
      "Write a product launch email for [PRODUCT]. Include a compelling subject line, benefit-led body, social proof, and a single clear CTA.",
    category: "Business",
    aiTool: "Claude",
    tags: ["email", "launch", "copywriting"],
    difficulty: "Beginner",
  },
  {
    title: "SQL Query Optimizer",
    description: "Optimize slow SQL queries with clear explanations.",
    content:
      "You are a database performance expert. Optimize this SQL query and explain each change, including indexing suggestions:\n\n[PASTE QUERY]",
    category: "Coding",
    aiTool: "ChatGPT",
    tags: ["sql", "database", "performance"],
    difficulty: "Pro",
  },
  {
    title: "Fantasy World Builder",
    description: "Generate rich worldbuilding lore for stories and games.",
    content:
      "Act as a worldbuilding assistant. Create lore for [WORLD NAME]: geography, factions, magic/tech system, conflicts, and three key locations.",
    category: "Writing",
    aiTool: "Claude",
    tags: ["worldbuilding", "fiction", "creative"],
    difficulty: "Intermediate",
  },
];

async function signUp(user) {
  try {
    const res = await fetch(`${CLIENT_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // better-auth validates the Origin against trustedOrigins.
        Origin: CLIENT_URL,
      },
      body: JSON.stringify({
        name: user.name,
        email: user.email,
        password: user.password,
      }),
    });
    if (res.ok) {
      console.log(`  signed up ${user.email}`);
    } else {
      const data = await res.json().catch(() => ({}));
      console.log(`  ${user.email} already exists or skipped (${data.message || res.status})`);
    }
  } catch (err) {
    console.error(`  could not reach ${CLIENT_URL} — is the client running?`);
    throw err;
  }
}

async function run() {
  console.log("Seeding demo users via better-auth...");
  for (const user of demoUsers) {
    await signUp(user);
  }

  console.log("Seeding extra creators via better-auth...");
  for (const user of extraCreators) {
    await signUp(user);
  }

  const client = new MongoClient(process.env.MONGO_DB_URI, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await client.connect();
  const db = client.db("promptverse-db");
  const userCollections = db.collection("user");
  const promptCollections = db.collection("prompts");
  const reviewCollections = db.collection("reviews");

  console.log("Setting roles + subscriptions...");
  for (const user of demoUsers) {
    await userCollections.updateOne(
      { email: user.email },
      { $set: { role: user.role, subscription: user.subscription } }
    );
    console.log(`  ${user.email} -> ${user.role} / ${user.subscription}`);
  }

  console.log("Setting extra creator roles + images...");
  for (const user of extraCreators) {
    await userCollections.updateOne(
      { email: user.email },
      {
        $set: {
          role: user.role,
          subscription: user.subscription,
          image: user.image,
        },
      }
    );
    console.log(`  ${user.email} -> ${user.role} / ${user.subscription}`);
  }

  const creator = await userCollections.findOne({ email: "creator@aiverse.com" });
  if (creator) {
    const creatorId = creator._id.toString();
    const existing = await promptCollections.countDocuments({
      creatorId,
    });
    if (existing === 0) {
      console.log("Inserting sample prompts...");
      const now = Date.now();
      const samples = [
        {
          title: "Ultimate Blog Post Writer",
          description: "Generate SEO-optimized blog posts on any topic in minutes.",
          content:
            "Act as an expert content writer. Write a 1500-word SEO blog post about [TOPIC]. Include an engaging intro, H2/H3 headings, a key-takeaways list, and a conclusion with a CTA.",
          category: "Writing",
          aiTool: "ChatGPT",
          tags: ["blog", "seo", "content"],
          difficulty: "Beginner",
          visibility: "public",
        },
        {
          title: "React Code Reviewer",
          description: "Get a senior-level review of your React components.",
          content:
            "You are a senior React engineer. Review the following component for performance, accessibility, and best practices, then provide a refactored version:\n\n[PASTE CODE]",
          category: "Coding",
          aiTool: "Claude",
          tags: ["react", "code review", "frontend"],
          difficulty: "Pro",
          visibility: "public",
        },
        {
          title: "Cinematic Midjourney Portraits",
          description: "Create stunning cinematic portrait prompts.",
          content:
            "cinematic portrait of [SUBJECT], dramatic rim lighting, 85mm lens, shallow depth of field, film grain, hyper-detailed, --ar 4:5 --style raw",
          category: "Image Generation",
          aiTool: "Midjourney",
          tags: ["portrait", "cinematic", "art"],
          difficulty: "Intermediate",
          visibility: "private",
        },
        {
          title: "Cold Email Outreach Sequence",
          description: "A 3-step cold email sequence that converts.",
          content:
            "Write a 3-email cold outreach sequence for [PRODUCT] targeting [AUDIENCE]. Email 1: hook + value. Email 2: social proof. Email 3: scarcity + CTA.",
          category: "Marketing",
          aiTool: "Gemini",
          tags: ["email", "sales", "outreach"],
          difficulty: "Intermediate",
          visibility: "public",
        },
        {
          title: "Study Plan Generator",
          description: "Build a personalized study schedule for any exam.",
          content:
            "Create a 30-day study plan for [EXAM]. Break it into weekly goals, daily tasks, and include revision days and practice tests.",
          category: "Education",
          aiTool: "ChatGPT",
          tags: ["study", "education", "planning"],
          difficulty: "Beginner",
          visibility: "public",
        },
        {
          title: "Startup Pitch Deck Outline",
          description: "Generate an investor-ready pitch deck outline.",
          content:
            "Act as a startup advisor. Create a 12-slide pitch deck outline for [STARTUP IDEA], including problem, solution, market size, business model, and the ask.",
          category: "Business",
          aiTool: "Claude",
          tags: ["startup", "pitch", "business"],
          difficulty: "Pro",
          visibility: "private",
        },
      ];

      const docs = samples.map((s, i) => ({
        ...s,
        thumbnailUrl: "",
        usageInstructions: "Replace the bracketed placeholders with your details.",
        copyCount: Math.floor(Math.random() * 200),
        avgRating: 0,
        reviewCount: 0,
        status: "approved",
        featured: i < 3,
        rejectionFeedback: "",
        creatorId,
        creatorName: creator.name,
        creatorEmail: creator.email,
        creatorImage: creator.image || "",
        createdAt: new Date(now - i * 86400000),
      }));
      await promptCollections.insertMany(docs);
      console.log(`  inserted ${docs.length} sample prompts`);
    } else {
      console.log("Sample prompts already exist, skipping.");
    }
  }

  console.log("Inserting prompts for extra creators...");
  const baseNow = Date.now();
  let poolIndex = 0;
  for (const ec of extraCreators) {
    const ecDoc = await userCollections.findOne({ email: ec.email });
    if (!ecDoc) continue;
    const ecId = ecDoc._id.toString();

    const existing = await promptCollections.countDocuments({ creatorId: ecId });
    if (existing > 0) {
      console.log(`  ${ec.email} already has prompts, skipping.`);
      continue;
    }

    // Give each creator 2 prompts from the shared pool (round-robin).
    const docs = [];
    for (let n = 0; n < 2; n++) {
      const sample = creatorPromptPool[poolIndex % creatorPromptPool.length];
      poolIndex++;
      docs.push({
        ...sample,
        visibility: poolIndex % 3 === 0 ? "private" : "public",
        thumbnailUrl: "",
        usageInstructions: "Replace the bracketed placeholders with your details.",
        copyCount: Math.floor(Math.random() * 500),
        avgRating: 0,
        reviewCount: 0,
        status: "approved",
        featured: false,
        rejectionFeedback: "",
        creatorId: ecId,
        creatorName: ecDoc.name,
        creatorEmail: ecDoc.email,
        creatorImage: ecDoc.image || "",
        createdAt: new Date(baseNow - poolIndex * 43200000),
      });
    }
    await promptCollections.insertMany(docs);
    console.log(`  ${ec.email} -> inserted ${docs.length} prompts`);
  }

  console.log("Inserting sample reviews...");
  const existingReviews = await reviewCollections.countDocuments({});
  if (existingReviews > 0) {
    console.log("  reviews already exist, skipping.");
  } else {
    const approved = await promptCollections
      .find({ status: "approved" })
      .sort({ createdAt: 1 })
      .toArray();
    const reviewers = await userCollections
      .find({
        email: {
          $in: [
            "user@aiverse.com",
            "admin@aiverse.com",
            "sophia@aiverse.com",
            "marcus@aiverse.com",
            "aisha@aiverse.com",
            "diego@aiverse.com",
            "emma@aiverse.com",
          ],
        },
      })
      .toArray();

    const reviewPool = [
      { rating: 5, comment: "The marketing prompts saved me hours every week. Incredible quality." },
      { rating: 5, comment: "Best place to find coding prompts — the review system keeps quality high." },
      { rating: 4, comment: "Premium was worth every cent. The private prompts are next level." },
      { rating: 5, comment: "I shipped a landing page in an afternoon thanks to these prompts." },
      { rating: 5, comment: "The image prompts are stunning. My Midjourney results improved instantly." },
      { rating: 4, comment: "Great variety across tools. Wish there were even more education prompts." },
      { rating: 5, comment: "Clean UI, fast search, and genuinely useful prompts. Highly recommend." },
      { rating: 5, comment: "Copy-paste, tweak the placeholders, done. Massive time saver." },
    ];

    if (approved.length && reviewers.length) {
      const now = Date.now();
      const docs = reviewPool.map((r, i) => {
        const prompt = approved[i % approved.length];
        const reviewer = reviewers[i % reviewers.length];
        return {
          promptId: prompt._id.toString(),
          userId: reviewer._id.toString(),
          name: reviewer.name,
          email: reviewer.email,
          image: reviewer.image || "",
          rating: r.rating,
          comment: r.comment,
          createdAt: new Date(now - i * 3600000),
        };
      });
      await reviewCollections.insertMany(docs);
      console.log(`  inserted ${docs.length} reviews`);

      // Recompute avgRating + reviewCount for reviewed prompts.
      const reviewedIds = [...new Set(docs.map((d) => d.promptId))];
      for (const pid of reviewedIds) {
        const agg = await reviewCollections
          .aggregate([
            { $match: { promptId: pid } },
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
            { _id: new ObjectId(pid) },
            { $set: { avgRating: agg[0].avg, reviewCount: agg[0].count } }
          );
        }
      }
      console.log("  recomputed prompt ratings");
    } else {
      console.log("  no prompts or reviewers found, skipping reviews.");
    }
  }

  console.log("Seed complete.");
  await client.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
