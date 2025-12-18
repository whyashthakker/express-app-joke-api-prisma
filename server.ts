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

// Test page route
app.get("/test", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "public", "test.html"));
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
      
      // Pages
      "GET /view": "View jokes in real-time",
      "GET /events": "SSE endpoint for real-time updates",
      "GET /docs": "API documentation",
      "GET /test": "API testing laboratory",
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

