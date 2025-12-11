# Jokes API with Express, Bun, and Prisma

A simple RESTful API for managing jokes, built with Express.js running on Bun runtime and using Prisma with PostgreSQL.

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh) installed on your system
- PostgreSQL database server running (local or remote)

### Installation

The dependencies are already installed. If you need to reinstall them:

```bash
bun install
```

### Database Setup

1. **Create a PostgreSQL database** (if you haven't already):
   ```bash
   # Using psql
   createdb api
   # Or connect to PostgreSQL and run:
   # CREATE DATABASE api;
   ```

2. **Configure your database connection** in `.env`:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/api?schema=public"
   ```
   Replace `username`, `password`, `localhost`, and `5432` with your PostgreSQL credentials.

3. **Generate Prisma Client and push schema to database**:
   ```bash
   bunx prisma generate
   bunx prisma db push
   ```
   
   Or use migrations for production:
   ```bash
   bunx prisma migrate dev --name init
   ```

### Running the Server

Start the development server:

```bash
bun run dev
```

Or simply:

```bash
bun server.ts
```

The server will start on `http://localhost:8080`

## 📚 API Endpoints

### Get All Jokes
```http
GET /jokes
```

Returns an array of all jokes, ordered by creation date (newest first).

### Get a Specific Joke
```http
GET /jokes/:id
```

Returns a single joke by ID.

### Create a New Joke
```http
POST /jokes
Content-Type: application/json

{
  "setup": "Why did the chicken cross the road?",
  "punchline": "To get to the other side!"
}
```

### Update a Joke
```http
PUT /jokes/:id
Content-Type: application/json

{
  "setup": "Updated setup",
  "punchline": "Updated punchline"
}
```

Both fields are optional in the update request.

### Delete a Joke
```http
DELETE /jokes/:id
```

### Get a Random Joke
```http
GET /jokes/random/one
```

Returns a random joke from the database.

## 🧪 Example Usage

### Using cURL

Add a joke:
```bash
curl -X POST http://localhost:8080/jokes \
  -H "Content-Type: application/json" \
  -d '{"setup":"Why do programmers prefer dark mode?","punchline":"Because light attracts bugs!"}'
```

Get all jokes:
```bash
curl http://localhost:8080/jokes
```

Get a random joke:
```bash
curl http://localhost:8080/jokes/random/one
```

### Using JavaScript/TypeScript

```typescript
// Add a joke
const response = await fetch('http://localhost:8080/jokes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    setup: 'Why do programmers prefer dark mode?',
    punchline: 'Because light attracts bugs!'
  })
});
const newJoke = await response.json();

// Get all jokes
const jokes = await fetch('http://localhost:8080/jokes').then(r => r.json());

// Get a random joke
const randomJoke = await fetch('http://localhost:8080/jokes/random/one').then(r => r.json());
```

## 📁 Project Structure

```
.
├── server.ts           # Express server with all routes
├── prisma/
│   └── schema.prisma  # Prisma schema definition
├── .env               # Environment variables (database URL)
├── package.json       # Project dependencies and scripts
└── README.md          # This file
```

## 🛠 Tech Stack

- **Runtime**: [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- **Framework**: [Express.js](https://expressjs.com) - Web framework
- **ORM**: [Prisma](https://www.prisma.io) - Next-generation ORM
- **Database**: PostgreSQL - Powerful open-source relational database

## 📝 Database Schema

```prisma
model Joke {
  id        Int      @id @default(autoincrement())
  setup     String
  punchline String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 🎯 Features

- ✅ Full CRUD operations for jokes
- ✅ Get random joke endpoint
- ✅ Automatic timestamps (createdAt, updatedAt)
- ✅ Input validation
- ✅ Error handling
- ✅ RESTful API design
- ✅ Graceful server shutdown

## 🤝 Contributing

Feel free to add more features, improve error handling, or add tests!

## 📄 License

MIT

