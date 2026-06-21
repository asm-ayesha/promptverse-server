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
const { MongoClient, ServerApiVersion } = require("mongodb");

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

  console.log("Setting roles + subscriptions...");
  for (const user of demoUsers) {
    await userCollections.updateOne(
      { email: user.email },
      { $set: { role: user.role, subscription: user.subscription } }
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

  console.log("Seed complete.");
  await client.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
