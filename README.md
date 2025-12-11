# 🎭 Real-Time Jokes API with Live View

A RESTful API for managing jokes with real-time updates, built with Express.js, Bun runtime, Prisma ORM, and PostgreSQL. Features a live web interface to watch jokes appear in real-time!

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
   createdb jokes_db
   # Or connect to PostgreSQL and run:
   # CREATE DATABASE jokes_db;
   ```

2. **Configure your database connection** in `.env`:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/jokes_db?schema=public"
   ADVANCED_AUTH_KEY="your-secret-auth-key-here"
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

### View Live Jokes Interface
```http
GET /view
```
Access the real-time web interface to watch jokes appear live!

### Get All Jokes
```http
GET /jokes
GET /jokes?name=Alice
```
Returns an array of all jokes, ordered by creation date (newest first). Optionally filter by author name using the `name` query parameter (case-insensitive partial matching).

### Get a Specific Joke
```http
GET /jokes/:id
```
Returns a single joke by ID.

### Create a New Joke (Basic)
```http
POST /jokes
Content-Type: application/json

{
  "name": "John Doe",
  "setup": "Why did the chicken cross the road?",
  "punchline": "To get to the other side!"
}
```

### Create a New Joke (Advanced with Auth)
```http
POST /advanced-joke
Content-Type: application/json
auth-key: your-secret-auth-key-here

{
  "name": "Jane Smith",
  "setup": "Why do programmers prefer dark mode?",
  "punchline": "Because light attracts bugs!"
}
```
Requires the `auth-key` header with the secret key configured in your environment.

### Update a Joke
```http
PUT /jokes/:id
Content-Type: application/json

{
  "name": "Updated Author",
  "setup": "Updated setup",
  "punchline": "Updated punchline"
}
```
All fields are optional in the update request.

### Delete a Joke
```http
DELETE /jokes/:id
```

### Get a Random Joke
```http
GET /jokes/random/one
```
Returns a random joke from the database.

### Real-Time Updates (Server-Sent Events)
```http
GET /events
```
Connect to receive real-time joke updates when new jokes are added.

### API Documentation
```http
GET /docs
```
View comprehensive API documentation with examples.

## 🧪 Example Usage

### Using cURL

Add a joke:
```bash
curl -X POST http://localhost:8080/jokes \
  -H "Content-Type: application/json" \
  -d '{"name":"John Doe","setup":"Why do programmers prefer dark mode?","punchline":"Because light attracts bugs!"}'
```

Get all jokes:
```bash
curl http://localhost:8080/jokes
```

Get jokes by author:
```bash
curl "http://localhost:8080/jokes?name=Alice"
```

Get a random joke:
```bash
curl http://localhost:8080/jokes/random/one
```

Delete a joke:
```bash
curl -X DELETE http://localhost:8080/jokes/1
```

Create joke with auth (advanced):
```bash
curl -X POST http://localhost:8080/advanced-joke \
  -H "Content-Type: application/json" \
  -H "auth-key: your-secret-auth-key-here" \
  -d '{"name":"Secure User","setup":"What do you call a bear with no teeth?","punchline":"A gummy bear!"}'
```

### Using JavaScript/TypeScript

```typescript
// Add a joke
const response = await fetch('http://localhost:8080/jokes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Jane Developer',
    setup: 'Why do programmers prefer dark mode?',
    punchline: 'Because light attracts bugs!'
  })
});
const newJoke = await response.json();

// Get all jokes
const jokes = await fetch('http://localhost:8080/jokes').then(r => r.json());

// Get jokes by author
const aliceJokes = await fetch('http://localhost:8080/jokes?name=Alice').then(r => r.json());

// Get a random joke
const randomJoke = await fetch('http://localhost:8080/jokes/random/one').then(r => r.json());

// Delete a joke
await fetch('http://localhost:8080/jokes/1', { method: 'DELETE' });

// Real-time updates
const eventSource = new EventSource('http://localhost:8080/events');
eventSource.onmessage = (event) => {
  const newJoke = JSON.parse(event.data);
  if (newJoke.type !== 'heartbeat') {
    console.log('New joke added:', newJoke);
  }
};
```

## 📁 Project Structure

```
.
├── server.ts           # Express server with all routes and SSE
├── prisma/
│   └── schema.prisma  # Prisma schema definition  
├── public/
│   ├── view.html      # Real-time jokes viewer interface
│   └── docs.html      # API documentation page
├── .env               # Environment variables (database URL, auth key)
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
  name      String   # Author/submitter name
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 🎯 Features

- ✅ Full CRUD operations for jokes
- ✅ Real-time updates with Server-Sent Events (SSE)
- ✅ Beautiful live web interface at `/view`
- ✅ Comprehensive API documentation at `/docs`
- ✅ Filter jokes by author name
- ✅ Advanced authentication for secure operations
- ✅ Get random joke endpoint
- ✅ Automatic timestamps (createdAt, updatedAt)
- ✅ Input validation and error handling
- ✅ RESTful API design
- ✅ Graceful server shutdown

## 🤝 Contributing

Feel free to add more features, improve error handling, or add tests!

## 📄 License

MIT

