import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import path from "path";

const app = express();
const port = 8080;
const prisma = new PrismaClient();

// Store SSE connections
let sseConnections: Response[] = [];

// Auth key for advanced operations
const ADVANCED_AUTH_KEY = process.env.ADVANCED_AUTH_KEY || "super-secret-auth-key-2024";

// Discord webhook for winner announcements
const DISCORD_WEBHOOK_URL = process.env.WINNER_ANNOUNCEMENT_DISCORD || null;

// Rate limiting for /prices/docs
interface RateLimitEntry {
  requests: number[];
  silencedUntil?: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up old entries every minute
setInterval(() => {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  
  for (const [ip, entry] of rateLimitMap.entries()) {
    // Remove old requests
    entry.requests = entry.requests.filter(time => time > oneMinuteAgo);
    
    // Remove silenced entries that have expired
    if (entry.silencedUntil && now > entry.silencedUntil) {
      entry.silencedUntil = undefined;
    }
    
    // Remove empty entries
    if (entry.requests.length === 0 && !entry.silencedUntil) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Pricing game configuration
const PRICE_VOLATILITY = 0.15; // 15% max price change
const CHALLENGE_EXPIRY_MINUTES = 10;
const CHALLENGE_TYPES = {
  math: {
    generate: () => {
      const operations = ['+', '-', '*'];
      const op = operations[Math.floor(Math.random() * operations.length)];
      let a, b, answer;
      
      switch (op) {
        case '+':
          a = Math.floor(Math.random() * 100) + 1;
          b = Math.floor(Math.random() * 100) + 1;
          answer = a + b;
          break;
        case '-':
          a = Math.floor(Math.random() * 100) + 50;
          b = Math.floor(Math.random() * 50) + 1;
          answer = a - b;
          break;
        case '*':
          a = Math.floor(Math.random() * 20) + 1;
          b = Math.floor(Math.random() * 20) + 1;
          answer = a * b;
          break;
      }
      
      return {
        question: `What is ${a} ${op} ${b}?`,
        answer: answer.toString(),
        hint: `The result is between ${answer - 10} and ${answer + 10}`
      };
    }
  },
  riddle: {
    generate: () => {
      const riddles = [
        { question: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?", answer: "map", hint: "You use this for navigation" },
        { question: "What has keys but no locks, space but no room, and you can enter but not go inside?", answer: "keyboard", hint: "You're probably touching one right now" },
        { question: "What gets wet while drying?", answer: "towel", hint: "You use this after a shower" },
        { question: "What can travel around the world while staying in a corner?", answer: "stamp", hint: "You put this on mail" },
        { question: "What has hands but cannot clap?", answer: "clock", hint: "It tells time" }
      ];
      return riddles[Math.floor(Math.random() * riddles.length)];
    }
  },
  logic: {
    generate: () => {
      const puzzles = [
        { question: "If you have 3 apples and you take away 2, how many do you have?", answer: "2", hint: "Think about what 'you take away' means" },
        { question: "What comes next in this sequence: 1, 1, 2, 3, 5, 8, ?", answer: "13", hint: "Each number is the sum of the previous two" },
        { question: "If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?", answer: "5", hint: "Think about the rate per machine" }
      ];
      return puzzles[Math.floor(Math.random() * puzzles.length)];
    }
  }
};

// HTTP request logging middleware
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const userAgent = req.get('User-Agent') || 'Unknown';
  const ip = req.ip || req.connection.remoteAddress || 'Unknown';
  
  // Log request
  console.log(`[${timestamp}] ${method} ${url} - IP: ${ip} - User-Agent: ${userAgent}`);
  
  // Capture response time
  const startTime = Date.now();
  
  // Override res.end to log response
  const originalEnd = res.end.bind(res);
  res.end = function(...args: any[]) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusColor = statusCode >= 200 && statusCode < 300 ? '\x1b[32m' : 
                       statusCode >= 300 && statusCode < 400 ? '\x1b[33m' : '\x1b[31m';
    
    console.log(`[${timestamp}] ${method} ${url} - ${statusColor}${statusCode}\x1b[0m - ${responseTime}ms`);
    
    // Call original end and return the result
    return originalEnd.apply(res, args);
  };
  
  next();
});

// Middleware to parse JSON
app.use(express.json());

// Serve static files
app.use(express.static("public"));

// GET all jokes (optionally filter by name)
app.get("/jokes", async (req: Request, res: Response) => {
  try {
    const { name } = req.query;
    const whereClause = name 
      ? { name: { contains: name as string, mode: "insensitive" as const } }
      : {};
    
    const jokes = await prisma.joke.findMany({
      where: whereClause,
      orderBy: {
        createdAt: "desc",
      },
    });
    res.json(jokes);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch jokes" });
  }
});

// GET a single joke by ID
app.get("/jokes/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const joke = await prisma.joke.findUnique({
      where: { id: parseInt(id) },
    });
    
    if (!joke) {
      return res.status(404).json({ error: "Joke not found" });
    }
    
    res.json(joke);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch joke" });
  }
});

// POST a new joke
app.post("/jokes", async (req: Request, res: Response) => {
  try {
    const { setup, punchline, name } = req.body;
    
    if (!setup || !punchline || !name) {
      return res.status(400).json({ error: "Setup, punchline, and name are required" });
    }
    
    const joke = await prisma.joke.create({
      data: {
        setup,
        punchline,
        name,
      },
    });
    
    // Notify all SSE connections about the new joke
    const message = `data: ${JSON.stringify(joke)}\n\n`;
    sseConnections.forEach((connection, index) => {
      try {
        connection.write(message);
      } catch (error) {
        // Remove dead connections
        sseConnections.splice(index, 1);
      }
    });
    
    res.status(201).json(joke);
  } catch (error) {
    res.status(500).json({ error: "Failed to create joke" });
  }
});

// PUT update a joke
app.put("/jokes/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { setup, punchline, name } = req.body;
    
    const joke = await prisma.joke.update({
      where: { id: parseInt(id) },
      data: {
        ...(setup && { setup }),
        ...(punchline && { punchline }),
        ...(name && { name }),
      },
    });
    
    res.json(joke);
  } catch (error) {
    res.status(500).json({ error: "Failed to update joke" });
  }
});

// DELETE a joke
app.delete("/jokes/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.joke.delete({
      where: { id: parseInt(id) },
    });
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete joke" });
  }
});

// GET a random joke
app.get("/jokes/random/one", async (req: Request, res: Response) => {
  try {
    const count = await prisma.joke.count();
    if (count === 0) {
      return res.status(404).json({ error: "No jokes available" });
    }
    
    const skip = Math.floor(Math.random() * count);
    const joke = await prisma.joke.findMany({
      take: 1,
      skip: skip,
    });
    
    res.json(joke[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch random joke" });
  }
});

// Advanced POST endpoint for creating jokes (requires auth-key header)
app.post("/advanced-joke", async (req: Request, res: Response) => {
  try {
    // Check auth-key header
    const authKey = req.headers['auth-key'];
    if (!authKey || authKey !== ADVANCED_AUTH_KEY) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing auth-key" });
    }

    const { setup, punchline, name } = req.body;
    
    if (!setup || !punchline || !name) {
      return res.status(400).json({ error: "Setup, punchline, and name are required" });
    }
    
    const joke = await prisma.joke.create({
      data: {
        setup,
        punchline,
        name,
      },
    });
    
    // Notify all SSE connections about the new joke
    const message = `data: ${JSON.stringify(joke)}\n\n`;
    sseConnections.forEach((connection, index) => {
      try {
        connection.write(message);
      } catch (error) {
        // Remove dead connections
        sseConnections.splice(index, 1);
      }
    });
    
    res.status(201).json(joke);
  } catch (error) {
    res.status(500).json({ error: "Failed to create joke" });
  }
});

// SSE endpoint for real-time updates
app.get("/events", (req: Request, res: Response) => {
  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control"
  });

  // Add this connection to our list
  sseConnections.push(res);

  // Send a heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write("data: {\"type\":\"heartbeat\"}\n\n");
    } catch (error) {
      clearInterval(heartbeat);
      // Remove dead connection
      const index = sseConnections.indexOf(res);
      if (index !== -1) {
        sseConnections.splice(index, 1);
      }
    }
  }, 30000);

  // Handle client disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    const index = sseConnections.indexOf(res);
    if (index !== -1) {
      sseConnections.splice(index, 1);
    }
  });
});

// View route
app.get("/view", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "view.html"));
});

// Documentation route
app.get("/docs", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "docs.html"));
});

// Price lottery documentation
app.get("/prices/docs", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "lottery-docs.html"));
});


// ============================================================================
// USER MANAGEMENT API
// ============================================================================

// GET all users
app.get("/users", async (req: Request, res: Response) => {
  try {
    const { city, active } = req.query;
    const whereClause: any = {};
    
    if (city) {
      whereClause.city = { contains: city as string, mode: "insensitive" };
    }
    if (active !== undefined) {
      whereClause.isActive = active === 'true';
    }
    
    const users = await prisma.user.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET single user
app.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id) },
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// POST new user
app.post("/users", async (req: Request, res: Response) => {
  try {
    const { email, name, age, city, isActive } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ error: "Email and name are required" });
    }
    
    const user = await prisma.user.create({
      data: {
        email,
        name,
        age: age ? parseInt(age) : null,
        city,
        isActive: isActive !== undefined ? isActive : true,
      },
    });
    
    res.status(201).json(user);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Failed to create user" });
    }
  }
});

// PUT update user
app.put("/users/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { email, name, age, city, isActive } = req.body;
    
    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: {
        ...(email && { email }),
        ...(name && { name }),
        ...(age !== undefined && { age: age ? parseInt(age) : null }),
        ...(city !== undefined && { city }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    
    res.json(user);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "User not found" });
    } else if (error.code === 'P2002') {
      res.status(400).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Failed to update user" });
    }
  }
});

// DELETE user
app.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.user.delete({
      where: { id: parseInt(id) },
    });
    
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(500).json({ error: "Failed to delete user" });
    }
  }
});

// ============================================================================
// PRODUCT CATALOG API
// ============================================================================

// GET all products
app.get("/products", async (req: Request, res: Response) => {
  try {
    const { category, inStock, minPrice, maxPrice } = req.query;
    const whereClause: any = {};
    
    if (category) {
      whereClause.category = { contains: category as string, mode: "insensitive" };
    }
    if (inStock !== undefined) {
      whereClause.inStock = inStock === 'true';
    }
    if (minPrice) {
      whereClause.price = { gte: parseFloat(minPrice as string) };
    }
    if (maxPrice) {
      whereClause.price = { ...whereClause.price, lte: parseFloat(maxPrice as string) };
    }
    
    const products = await prisma.product.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// GET single product
app.get("/products/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
    });
    
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

// POST new product
app.post("/products", async (req: Request, res: Response) => {
  try {
    const { name, description, price, category, inStock, quantity } = req.body;
    
    if (!name || !price || !category) {
      return res.status(400).json({ error: "Name, price, and category are required" });
    }
    
    const product = await prisma.product.create({
      data: {
        name,
        description,
        price: parseFloat(price),
        category,
        inStock: inStock !== undefined ? inStock : true,
        quantity: quantity ? parseInt(quantity) : 0,
      },
    });
    
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: "Failed to create product" });
  }
});

// PUT update product
app.put("/products/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, inStock, quantity } = req.body;
    
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(price && { price: parseFloat(price) }),
        ...(category && { category }),
        ...(inStock !== undefined && { inStock }),
        ...(quantity !== undefined && { quantity: parseInt(quantity) }),
      },
    });
    
    res.json(product);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Product not found" });
    } else {
      res.status(500).json({ error: "Failed to update product" });
    }
  }
});

// DELETE product
app.delete("/products/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({
      where: { id: parseInt(id) },
    });
    
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Product not found" });
    } else {
      res.status(500).json({ error: "Failed to delete product" });
    }
  }
});

// ============================================================================
// PRICING GAME API
// ============================================================================

// Helper function to calculate dynamic price
function calculateDynamicPrice(basePrice: number, productId: number): number {
  const time = Date.now();
  const seed = Math.sin(productId * time / 100000); // Dynamic seed based on product and time
  const volatility = PRICE_VOLATILITY * (0.5 + Math.abs(seed));
  const change = 1 + (volatility * Math.sin(time / 60000) * Math.cos(productId));
  return Math.round(basePrice * change * 100) / 100;
}

// Helper function to generate challenge
function generateChallenge(productId: number): any {
  const types = Object.keys(CHALLENGE_TYPES);
  const selectedType = types[Math.floor(Math.random() * types.length)] as keyof typeof CHALLENGE_TYPES;
  const challenge = CHALLENGE_TYPES[selectedType].generate();
  
  return {
    ...challenge,
    type: selectedType,
    difficulty: selectedType === 'math' ? 'easy' : selectedType === 'riddle' ? 'medium' : 'hard'
  };
}

// Helper function to send Discord notification
async function sendDiscordNotification(productName: string, winner: string, originalPrice: number, claimedPrice: number) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  try {
    const embed = {
      title: "🎉 PRICING GAME WINNER!",
      description: `**${winner}** just claimed an amazing deal!`,
      color: 0x00ff00,
      fields: [
        {
          name: "🏆 Product",
          value: productName,
          inline: true
        },
        {
          name: "💰 Original Price",
          value: `$${originalPrice}`,
          inline: true
        },
        {
          name: "🔥 Claimed Price",
          value: `$${claimedPrice}`,
          inline: true
        },
        {
          name: "💸 Savings",
          value: `$${(originalPrice - claimedPrice).toFixed(2)} (${((originalPrice - claimedPrice) / originalPrice * 100).toFixed(1)}%)`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Pricing Game API"
      }
    };

    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });
  } catch (error) {
    console.error('Failed to send Discord notification:', error);
  }
}

// GET dynamic pricing for a product
app.get("/pricing/:productId", async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const product = await prisma.product.findUnique({
      where: { id: parseInt(productId) },
    });
    
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const currentPrice = calculateDynamicPrice(product.price, product.id);
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate challenge
    const challengeData = generateChallenge(product.id);
    const expiresAt = new Date(Date.now() + CHALLENGE_EXPIRY_MINUTES * 60 * 1000);
    
    // Store challenge in database
    const challenge = await prisma.challenge.create({
      data: {
        productId: product.id,
        requestId,
        question: challengeData.question,
        answer: challengeData.answer,
        hint: challengeData.hint,
        difficulty: challengeData.difficulty,
        expiresAt
      }
    });

    // Store price history
    await prisma.priceHistory.create({
      data: {
        productId: product.id,
        price: currentPrice
      }
    });

    res.json({
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        inStock: product.inStock,
        quantity: product.quantity
      },
      pricing: {
        originalPrice: product.price,
        currentPrice,
        lastUpdated: new Date().toISOString(),
        volatility: PRICE_VOLATILITY,
        savingsOpportunity: product.price > currentPrice ? (product.price - currentPrice).toFixed(2) : null
      },
      challenge: {
        requestId,
        question: challengeData.question,
        hint: challengeData.hint,
        difficulty: challengeData.difficulty,
        type: challengeData.type,
        expiresAt: expiresAt.toISOString(),
        timeLeft: `${CHALLENGE_EXPIRY_MINUTES} minutes`
      },
      instructions: {
        howToClaim: "Solve the challenge and POST to /pricing/claim with your requestId and answer",
        example: `POST /pricing/claim { "requestId": "${requestId}", "answer": "your_solution", "claimedBy": "your_name" }`
      }
    });
  } catch (error) {
    console.error('Error getting dynamic pricing:', error);
    res.status(500).json({ error: "Failed to get dynamic pricing" });
  }
});

// POST claim product with challenge solution
app.post("/pricing/claim", async (req: Request, res: Response) => {
  try {
    const { requestId, answer, claimedBy } = req.body;
    
    if (!requestId || !answer || !claimedBy) {
      return res.status(400).json({ 
        error: "requestId, answer, and claimedBy are required",
        example: { requestId: "req_123", answer: "42", claimedBy: "your_name" }
      });
    }

    // Find the challenge
    const challenge = await prisma.challenge.findUnique({
      where: { requestId },
      include: { product: true }
    });

    if (!challenge) {
      return res.status(404).json({ error: "Challenge not found or expired" });
    }

    // Check if already claimed
    if (challenge.claimed) {
      return res.status(409).json({ error: "This challenge has already been claimed" });
    }

    // Check if expired
    if (new Date() > challenge.expiresAt) {
      return res.status(410).json({ error: "Challenge has expired" });
    }

    // Check if answer is correct (case insensitive)
    if (answer.toString().toLowerCase().trim() !== challenge.answer.toLowerCase().trim()) {
      return res.status(400).json({ 
        error: "Incorrect answer", 
        hint: challenge.hint,
        timeLeft: Math.max(0, Math.floor((challenge.expiresAt.getTime() - Date.now()) / 1000 / 60))
      });
    }

    // Calculate the price at time of challenge creation
    const claimedPrice = calculateDynamicPrice(challenge.product.price, challenge.productId);
    
    // Mark challenge as claimed
    await prisma.challenge.update({
      where: { id: challenge.id },
      data: {
        claimed: true,
        claimedBy
      }
    });

    // Create claim record
    const claim = await prisma.claim.create({
      data: {
        productId: challenge.productId,
        challengeId: challenge.id,
        claimedBy,
        originalPrice: challenge.product.price,
        claimedPrice
      }
    });

    // Send Discord notification
    await sendDiscordNotification(
      challenge.product.name,
      claimedBy,
      challenge.product.price,
      claimedPrice
    );

    // Notify SSE connections about the win
    const winMessage = {
      type: 'pricing_game_win',
      winner: claimedBy,
      product: challenge.product.name,
      originalPrice: challenge.product.price,
      claimedPrice,
      savings: (challenge.product.price - claimedPrice).toFixed(2),
      timestamp: new Date().toISOString()
    };

    const sseMessage = `data: ${JSON.stringify(winMessage)}\n\n`;
    sseConnections.forEach((connection, index) => {
      try {
        connection.write(sseMessage);
      } catch (error) {
        sseConnections.splice(index, 1);
      }
    });

    res.json({
      success: true,
      message: `Congratulations ${claimedBy}! You've successfully claimed the deal!`,
      claim: {
        id: claim.id,
        product: challenge.product.name,
        originalPrice: challenge.product.price,
        claimedPrice,
        savings: (challenge.product.price - claimedPrice).toFixed(2),
        savingsPercentage: ((challenge.product.price - claimedPrice) / challenge.product.price * 100).toFixed(1) + '%',
        claimedAt: claim.timestamp.toISOString()
      },
      challenge: {
        question: challenge.question,
        yourAnswer: answer,
        difficulty: challenge.difficulty,
        solvedIn: Math.floor((Date.now() - challenge.createdAt.getTime()) / 1000) + ' seconds'
      }
    });
  } catch (error) {
    console.error('Error claiming product:', error);
    res.status(500).json({ error: "Failed to process claim" });
  }
});

// GET pricing history for a product
app.get("/pricing/:productId/history", async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { hours = "24" } = req.query;
    
    const hoursAgo = new Date(Date.now() - parseInt(hours as string) * 60 * 60 * 1000);
    
    const [product, priceHistory] = await Promise.all([
      prisma.product.findUnique({
        where: { id: parseInt(productId) }
      }),
      prisma.priceHistory.findMany({
        where: {
          productId: parseInt(productId),
          timestamp: { gte: hoursAgo }
        },
        orderBy: { timestamp: "asc" }
      })
    ]);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const currentPrice = calculateDynamicPrice(product.price, product.id);
    
    res.json({
      product: {
        id: product.id,
        name: product.name,
        basePrice: product.price
      },
      currentPrice,
      history: priceHistory,
      analytics: {
        timeframe: `${hours} hours`,
        dataPoints: priceHistory.length,
        minPrice: Math.min(...priceHistory.map(h => h.price), currentPrice),
        maxPrice: Math.max(...priceHistory.map(h => h.price), currentPrice),
        avgPrice: priceHistory.length > 0 ? 
          (priceHistory.reduce((sum, h) => sum + h.price, 0) / priceHistory.length).toFixed(2) : 
          currentPrice
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch pricing history" });
  }
});

// GET recent claims/wins
app.get("/pricing/claims", async (req: Request, res: Response) => {
  try {
    const { limit = "10" } = req.query;
    
    const claims = await prisma.claim.findMany({
      take: parseInt(limit as string),
      orderBy: { timestamp: "desc" },
      include: {
        product: {
          select: { id: true, name: true, category: true }
        },
        challenge: {
          select: { question: true, difficulty: true, type: true }
        }
      }
    });

    res.json({
      recentWins: claims.map(claim => ({
        id: claim.id,
        winner: claim.claimedBy,
        product: claim.product,
        originalPrice: claim.originalPrice,
        claimedPrice: claim.claimedPrice,
        savings: (claim.originalPrice - claim.claimedPrice).toFixed(2),
        savingsPercentage: ((claim.originalPrice - claim.claimedPrice) / claim.originalPrice * 100).toFixed(1) + '%',
        challengeInfo: {
          question: claim.challenge.question,
          difficulty: claim.challenge.difficulty,
          type: claim.challenge.type
        },
        timestamp: claim.timestamp
      })),
      stats: {
        totalClaims: claims.length,
        totalSavings: claims.reduce((sum, claim) => sum + (claim.originalPrice - claim.claimedPrice), 0).toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch claims" });
  }
});

// ============================================================================
// PRICE LOTTERY API
// ============================================================================

// Helper function to check rate limiting
function checkRateLimit(ip: string): { allowed: boolean; silencedUntil?: number; reason?: string } {
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { requests: [] });
  }
  
  const entry = rateLimitMap.get(ip)!;
  
  // Check if currently silenced
  if (entry.silencedUntil && now < entry.silencedUntil) {
    return {
      allowed: false,
      silencedUntil: entry.silencedUntil,
      reason: `Rate limited. Silenced until ${new Date(entry.silencedUntil).toISOString()}`
    };
  }
  
  // Remove old requests (older than 1 second)
  entry.requests = entry.requests.filter(time => time > oneSecondAgo);
  
  // Check if more than 1 request in the last second
  if (entry.requests.length >= 1) {
    // Silence for 10 seconds
    entry.silencedUntil = now + 10000;
    return {
      allowed: false,
      silencedUntil: entry.silencedUntil,
      reason: "Rate limit exceeded (>1 RPS). Silenced for 10 seconds."
    };
  }
  
  // Add current request
  entry.requests.push(now);
  return { allowed: true };
}

// Helper function to send winner notification for price lottery
async function sendPriceLotteryWinNotification(winner: string, winningPrice: number, timestamp: string) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  try {
    const embed = {
      title: "🎰 PRICE LOTTERY WINNER! 🎰",
      description: `**${winner}** just hit the JACKPOT!`,
      color: 0xffd700, // Gold color
      fields: [
        {
          name: "🏆 Winner",
          value: winner,
          inline: true
        },
        {
          name: "🎯 Winning Price",
          value: `**${winningPrice}**`,
          inline: true
        },
        {
          name: "📊 Probability",
          value: "0.1% (1 in 1000)",
          inline: true
        },
        {
          name: "⏰ Won At",
          value: new Date(timestamp).toLocaleString(),
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: "Price Lottery API • What are the odds?!"
      },
      thumbnail: {
        url: "https://emojipedia-us.s3.dualstack.us-west-1.amazonaws.com/thumbs/120/apple/354/party-popper_1f389.png"
      }
    };

    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });
  } catch (error) {
    console.error('Failed to send price lottery Discord notification:', error);
  }
}

// Store active challenges for price lottery
interface PriceLotteryChallenge {
  challengeId: string;
  ip: string;
  question: string;
  answer: number;
  createdAt: number;
  expiresAt: number;
}

const activePriceChallenges = new Map<string, PriceLotteryChallenge>();

// Clean up expired challenges
setInterval(() => {
  const now = Date.now();
  for (const [challengeId, challenge] of activePriceChallenges.entries()) {
    if (now > challenge.expiresAt) {
      activePriceChallenges.delete(challengeId);
    }
  }
}, 30000); // Clean every 30 seconds

// Helper function to generate math problem
function generateMathProblem(): { question: string; answer: number } {
  const operations = ['+', '-', '*'];
  const op = operations[Math.floor(Math.random() * operations.length)];
  let a, b, answer;
  
  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 500) + 1;
      b = Math.floor(Math.random() * 500) + 1;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 500) + 200;
      b = Math.floor(Math.random() * 200) + 1;
      answer = a - b;
      break;
    case '*':
      a = Math.floor(Math.random() * 50) + 1;
      b = Math.floor(Math.random() * 50) + 1;
      answer = a * b;
      break;
    default:
      a = 10;
      b = 5;
      answer = 15;
  }
  
  return {
    question: `What is ${a} ${op} ${b}?`,
    answer
  };
}

// GET /prices - Price Lottery Endpoint
app.get("/prices", async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const timestamp = new Date().toISOString();
    
    // Check rate limiting
    const rateLimitCheck = checkRateLimit(ip);
    
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        error: "Rate Limited",
        message: rateLimitCheck.reason,
        silencedUntil: rateLimitCheck.silencedUntil ? new Date(rateLimitCheck.silencedUntil).toISOString() : undefined,
        timeRemaining: rateLimitCheck.silencedUntil ? Math.max(0, Math.ceil((rateLimitCheck.silencedUntil - Date.now()) / 1000)) + ' seconds' : undefined,
        tip: "Max 1 request per second. Exceeding this results in 10-second silence."
      });
    }
    
    // Generate random price (1-100)
    const randomPrice = Math.floor(Math.random() * 100) + 1;
    const isWinner = randomPrice === 1;
    
    // Base response
    const response: any = {
      price: randomPrice,
      timestamp,
      request: {
        ip: ip.replace(/:\d+$/, ''), // Hide port for privacy
        userAgent: userAgent.substring(0, 100)
      },
      lottery: {
        isWinner,
        winningNumber: 1,
        probability: "1%",
        odds: "1 in 100"
      },
      rateLimit: {
        remainingRequests: 0,
        resetIn: "1 second"
      },
      documentation: {
        description: "Price Lottery Game - Get random prices 1-100, solve math when you hit 1!",
        rules: [
          "Price = 1 triggers math challenge",
          "Solve within 60 seconds to win",
          "Maximum 1 request per second",
          ">1 RPS = 10-second silence",
          "Winners announced on Discord"
        ],
        flow: [
          "1. GET /prices until you get price = 1",
          "2. Receive math challenge with challengeId", 
          "3. POST /prices/solve with answer within 60s",
          "4. Win if correct!"
        ]
      }
    };
    
    // Handle getting price = 1
    if (isWinner) {
      const mathProblem = generateMathProblem();
      const challengeId = `challenge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const expiresAt = Date.now() + 60000; // 60 seconds
      
      // Store challenge
      activePriceChallenges.set(challengeId, {
        challengeId,
        ip,
        question: mathProblem.question,
        answer: mathProblem.answer,
        createdAt: Date.now(),
        expiresAt
      });
      
      response.challenge = {
        status: "JACKPOT! You got price = 1!",
        challengeId,
        question: mathProblem.question,
        timeLimit: "60 seconds",
        expiresAt: new Date(expiresAt).toISOString(),
        instructions: `POST /prices/solve with: {"challengeId": "${challengeId}", "answer": YOUR_ANSWER, "winner": "YOUR_NAME"}`,
        warning: "You have 60 seconds to solve this!"
      };
      
      // Notify SSE about someone getting price = 1
      const challengeMessage = {
        type: 'price_lottery_challenge',
        ip: ip.replace(/:\d+$/, ''),
        question: mathProblem.question,
        timestamp
      };
      
      const sseMessage = `data: ${JSON.stringify(challengeMessage)}\n\n`;
      sseConnections.forEach((connection, index) => {
        try {
          connection.write(sseMessage);
        } catch (error) {
          sseConnections.splice(index, 1);
        }
      });
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('Error in price lottery:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /prices/solve - Solve math challenge
app.post("/prices/solve", async (req: Request, res: Response) => {
  try {
    const { challengeId, answer, winner } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    
    if (!challengeId || answer === undefined) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["challengeId", "answer"],
        example: { challengeId: "challenge_123", answer: 42, winner: "YourName" }
      });
    }
    
    // Find challenge
    const challenge = activePriceChallenges.get(challengeId);
    if (!challenge) {
      return res.status(404).json({
        error: "Challenge not found or expired",
        tip: "Challenges expire after 60 seconds"
      });
    }
    
    // Check if expired
    if (Date.now() > challenge.expiresAt) {
      activePriceChallenges.delete(challengeId);
      return res.status(410).json({
        error: "Challenge expired",
        solveTime: Math.floor((Date.now() - challenge.createdAt) / 1000) + " seconds"
      });
    }
    
    // Check if correct IP (basic security)
    if (challenge.ip !== ip) {
      return res.status(403).json({
        error: "Challenge can only be solved by the original requester"
      });
    }
    
    // Check answer
    const submittedAnswer = parseInt(answer);
    if (submittedAnswer !== challenge.answer) {
      return res.status(400).json({
        error: "Incorrect answer",
        question: challenge.question,
        yourAnswer: submittedAnswer,
        timeRemaining: Math.max(0, Math.ceil((challenge.expiresAt - Date.now()) / 1000)) + " seconds"
      });
    }
    
    // WINNER!
    activePriceChallenges.delete(challengeId);
    const solveTime = Math.floor((Date.now() - challenge.createdAt) / 1000);
    const winnerName = winner || ip.replace(/:\d+$/, '');
    const timestamp = new Date().toISOString();
    
    // Send Discord notification
    await sendPriceLotteryWinNotification(winnerName, 1, timestamp);
    
    // Notify SSE connections about the win
    const winMessage = {
      type: 'price_lottery_win',
      winner: winnerName,
      question: challenge.question,
      answer: challenge.answer,
      solveTime: solveTime + " seconds",
      timestamp
    };
    
    const sseMessage = `data: ${JSON.stringify(winMessage)}\n\n`;
    sseConnections.forEach((connection, index) => {
      try {
        connection.write(sseMessage);
      } catch (error) {
        sseConnections.splice(index, 1);
      }
    });
    
    res.json({
      success: true,
      winner: winnerName,
      message: `🎉 CONGRATULATIONS! ${winnerName} won the price lottery!`,
      challenge: {
        question: challenge.question,
        correctAnswer: challenge.answer,
        yourAnswer: submittedAnswer,
        solveTime: solveTime + " seconds"
      },
      achievement: "You beat the odds and solved the math problem!",
      announcement: "Winner announced on Discord and live feeds!"
    });
    
  } catch (error) {
    console.error('Error solving challenge:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /prices/docs/stats - Lottery statistics
app.get("/prices/docs/stats", (req: Request, res: Response) => {
  const now = Date.now();
  const activeRateLimits = Array.from(rateLimitMap.entries()).map(([ip, entry]) => ({
    ip: ip.replace(/:\d+$/, ''), // Hide port for privacy
    requestsInLastSecond: entry.requests.filter(time => time > now - 1000).length,
    silenced: entry.silencedUntil ? entry.silencedUntil > now : false,
    silenceExpiry: entry.silencedUntil && entry.silencedUntil > now ? new Date(entry.silencedUntil).toISOString() : null
  })).filter(item => item.requestsInLastSecond > 0 || item.silenced);
  
  res.json({
    lottery: {
      winningNumber: 1,
      probability: 0.1,
      odds: "1 in 1000",
      priceRange: "1-100"
    },
    rateLimit: {
      maxRPS: 1,
      silenceDuration: "10 seconds",
      activeConnections: activeRateLimits.length,
      currentLimits: activeRateLimits
    },
    system: {
      totalRateLimitEntries: rateLimitMap.size,
      uptime: process.uptime() + " seconds"
    },
    howToWin: [
      "Send GET request to /prices/docs",
      "Hope for price = 1 (0.1% chance)",
      "Don't exceed 1 RPS or get silenced",
      "Winners announced on Discord!"
    ]
  });
});

// ============================================================================
// TASK MANAGEMENT API
// ============================================================================

// GET all tasks
app.get("/tasks", async (req: Request, res: Response) => {
  try {
    const { completed, priority } = req.query;
    const whereClause: any = {};
    
    if (completed !== undefined) {
      whereClause.completed = completed === 'true';
    }
    if (priority) {
      whereClause.priority = priority as string;
    }
    
    const tasks = await prisma.task.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// GET single task
app.get("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: parseInt(id) },
    });
    
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

// POST new task
app.post("/tasks", async (req: Request, res: Response) => {
  try {
    const { title, description, completed, priority, dueDate } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }
    
    const task = await prisma.task.create({
      data: {
        title,
        description,
        completed: completed || false,
        priority: priority || "medium",
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });
    
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PUT update task
app.put("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, completed, priority, dueDate } = req.body;
    
    const task = await prisma.task.update({
      where: { id: parseInt(id) },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(completed !== undefined && { completed }),
        ...(priority && { priority }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      },
    });
    
    res.json(task);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Task not found" });
    } else {
      res.status(500).json({ error: "Failed to update task" });
    }
  }
});

// DELETE task
app.delete("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.task.delete({
      where: { id: parseInt(id) },
    });
    
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Task not found" });
    } else {
      res.status(500).json({ error: "Failed to delete task" });
    }
  }
});

// ============================================================================
// WEATHER DATA API
// ============================================================================

// GET all weather data
app.get("/weather", async (req: Request, res: Response) => {
  try {
    const { city, condition } = req.query;
    const whereClause: any = {};
    
    if (city) {
      whereClause.city = { contains: city as string, mode: "insensitive" };
    }
    if (condition) {
      whereClause.condition = { contains: condition as string, mode: "insensitive" };
    }
    
    const weatherData = await prisma.weatherData.findMany({
      where: whereClause,
      orderBy: { recordedAt: "desc" },
    });
    res.json(weatherData);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

// GET weather by city (latest)
app.get("/weather/:city", async (req: Request, res: Response) => {
  try {
    const { city } = req.params;
    const weather = await prisma.weatherData.findFirst({
      where: { 
        city: { 
          equals: city,
          mode: "insensitive" 
        } 
      },
      orderBy: { recordedAt: "desc" },
    });
    
    if (!weather) {
      return res.status(404).json({ error: "No weather data found for this city" });
    }
    
    res.json(weather);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch weather data" });
  }
});

// POST new weather data
app.post("/weather", async (req: Request, res: Response) => {
  try {
    const { city, temperature, condition, humidity, windSpeed } = req.body;
    
    if (!city || temperature === undefined || !condition || humidity === undefined) {
      return res.status(400).json({ error: "City, temperature, condition, and humidity are required" });
    }
    
    const weather = await prisma.weatherData.create({
      data: {
        city,
        temperature: parseFloat(temperature),
        condition,
        humidity: parseInt(humidity),
        windSpeed: windSpeed ? parseFloat(windSpeed) : null,
      },
    });
    
    res.status(201).json(weather);
  } catch (error) {
    res.status(500).json({ error: "Failed to create weather data" });
  }
});

// ============================================================================
// BLOG/POSTS API
// ============================================================================

// GET all posts
app.get("/posts", async (req: Request, res: Response) => {
  try {
    const { author, published, tag } = req.query;
    const whereClause: any = {};
    
    if (author) {
      whereClause.author = { contains: author as string, mode: "insensitive" };
    }
    if (published !== undefined) {
      whereClause.published = published === 'true';
    }
    if (tag) {
      whereClause.tags = { has: tag as string };
    }
    
    const posts = await prisma.post.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

// GET single post
app.get("/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({
      where: { id: parseInt(id) },
    });
    
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }
    
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch post" });
  }
});

// POST new post
app.post("/posts", async (req: Request, res: Response) => {
  try {
    const { title, content, author, published, tags } = req.body;
    
    if (!title || !content || !author) {
      return res.status(400).json({ error: "Title, content, and author are required" });
    }
    
    const post = await prisma.post.create({
      data: {
        title,
        content,
        author,
        published: published || false,
        tags: tags || [],
      },
    });
    
    res.status(201).json(post);
  } catch (error) {
    res.status(500).json({ error: "Failed to create post" });
  }
});

// PUT update post
app.put("/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, author, published, tags } = req.body;
    
    const post = await prisma.post.update({
      where: { id: parseInt(id) },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(author && { author }),
        ...(published !== undefined && { published }),
        ...(tags !== undefined && { tags }),
      },
    });
    
    res.json(post);
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Post not found" });
    } else {
      res.status(500).json({ error: "Failed to update post" });
    }
  }
});

// DELETE post
app.delete("/posts/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.post.delete({
      where: { id: parseInt(id) },
    });
    
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      res.status(404).json({ error: "Post not found" });
    } else {
      res.status(500).json({ error: "Failed to delete post" });
    }
  }
});

// Root route
app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// API info route (for JSON endpoint info)
app.get("/api", (req: Request, res: Response) => {
  res.json({
    message: "Welcome to the Multi-API Learning Platform!",
    endpoints: {
      // Jokes API
      "GET /jokes": "Get all jokes (optional ?name=author query parameter)",
      "GET /jokes/:id": "Get a specific joke",
      "POST /jokes": "Create a new joke (requires setup, punchline, and name)",
      "PUT /jokes/:id": "Update a joke",
      "DELETE /jokes/:id": "Delete a joke",
      "GET /jokes/random/one": "Get a random joke",
      "POST /advanced-joke": "Create a new joke (requires auth-key header)",
      
      // Users API
      "GET /users": "Get all users (optional ?city=name&active=true/false)",
      "GET /users/:id": "Get a specific user",
      "POST /users": "Create a new user (requires email, name)",
      "PUT /users/:id": "Update a user",
      "DELETE /users/:id": "Delete a user",
      
      // Products API
      "GET /products": "Get all products (optional ?category=name&inStock=true&minPrice=X&maxPrice=Y)",
      "GET /products/:id": "Get a specific product",
      "POST /products": "Create a new product (requires name, price, category)",
      "PUT /products/:id": "Update a product",
      "DELETE /products/:id": "Delete a product",
      
      // Tasks API
      "GET /tasks": "Get all tasks (optional ?completed=true/false&priority=low/medium/high)",
      "GET /tasks/:id": "Get a specific task",
      "POST /tasks": "Create a new task (requires title)",
      "PUT /tasks/:id": "Update a task",
      "DELETE /tasks/:id": "Delete a task",
      
      // Weather API
      "GET /weather": "Get all weather data (optional ?city=name&condition=sunny)",
      "GET /weather/:city": "Get latest weather for a city",
      "POST /weather": "Record weather data (requires city, temperature, condition, humidity)",
      
      // Posts API
      "GET /posts": "Get all posts (optional ?author=name&published=true&tag=tech)",
      "GET /posts/:id": "Get a specific post",
      "POST /posts": "Create a new post (requires title, content, author)",
      "PUT /posts/:id": "Update a post",
      "DELETE /posts/:id": "Delete a post",
      
      // Pricing Game API
      "GET /pricing/:productId": "Get dynamic pricing and challenge for a product",
      "POST /pricing/claim": "Claim a product by solving the challenge",
      "GET /pricing/:productId/history": "Get pricing history for a product",
      "GET /pricing/claims": "Get recent successful claims and winners",
      
      // Price Lottery API
      "GET /prices": "Price lottery - Random prices 1-100, get math challenge when price=1",
      "POST /prices/solve": "Solve math challenge to win the lottery",
      "GET /prices/docs": "Price lottery documentation and game rules",
      
      // Pages
      "GET /view": "View jokes in real-time",
      "GET /events": "SSE endpoint for real-time updates",
      "GET /docs": "API documentation",
    },
  });
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}...`);
  console.log(`📝 API documentation available at http://localhost:${port}/`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

