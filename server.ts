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
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusColor = statusCode >= 200 && statusCode < 300 ? '\x1b[32m' : 
                       statusCode >= 300 && statusCode < 400 ? '\x1b[33m' : '\x1b[31m';
    
    console.log(`[${timestamp}] ${method} ${url} - ${statusColor}${statusCode}\x1b[0m - ${responseTime}ms`);
    
    // Call original end
    originalEnd.apply(this, args);
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

// Root route
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Welcome to the Jokes API!",
    endpoints: {
      "GET /jokes": "Get all jokes (optional ?name=author query parameter)",
      "GET /jokes/:id": "Get a specific joke",
      "POST /jokes": "Create a new joke (requires setup, punchline, and name)",
      "PUT /jokes/:id": "Update a joke",
      "DELETE /jokes/:id": "Delete a joke",
      "GET /jokes/random/one": "Get a random joke",
      "POST /advanced-joke": "Create a new joke (requires auth-key header)",
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

