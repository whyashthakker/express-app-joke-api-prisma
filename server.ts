import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const port = 8080;
const prisma = new PrismaClient();

// Middleware to parse JSON
app.use(express.json());

// GET all jokes
app.get("/jokes", async (req: Request, res: Response) => {
  try {
    const jokes = await prisma.joke.findMany({
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
    const { setup, punchline } = req.body;
    
    if (!setup || !punchline) {
      return res.status(400).json({ error: "Setup and punchline are required" });
    }
    
    const joke = await prisma.joke.create({
      data: {
        setup,
        punchline,
      },
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
    const { setup, punchline } = req.body;
    
    const joke = await prisma.joke.update({
      where: { id: parseInt(id) },
      data: {
        ...(setup && { setup }),
        ...(punchline && { punchline }),
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

// Root route
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Welcome to the Jokes API!",
    endpoints: {
      "GET /jokes": "Get all jokes",
      "GET /jokes/:id": "Get a specific joke",
      "POST /jokes": "Create a new joke (requires setup and punchline)",
      "PUT /jokes/:id": "Update a joke",
      "DELETE /jokes/:id": "Delete a joke",
      "GET /jokes/random/one": "Get a random joke",
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

