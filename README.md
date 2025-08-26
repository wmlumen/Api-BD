# Multi-Project API with AI Integration

A multi-tenant API with AI-powered query translation and execution. This API allows users to manage projects, databases, and execute queries using natural language.

## Features

- **Multi-tenancy**: Isolated projects with separate databases
- **Role-based access control**: User, Editor, and Admin roles
- **AI-powered queries**: Natural language to SQL/NoSQL translation
- **Database management**: Support for multiple database types (PostgreSQL, MySQL, MongoDB, SQLite, MSSQL)
- **RESTful API**: Well-documented endpoints for all operations
- **JWT Authentication**: Secure authentication with refresh tokens
- **Email notifications**: For user registration, password resets, and project invitations
- **Query history**: Track and audit all database queries
- **File uploads**: Support for file attachments

## Prerequisites

- Node.js 16+ and npm 8+
- PostgreSQL 12+
- Redis (for caching and rate limiting)
- SMTP server (or service like SendGrid, Mailgun, etc.)
- OpenAI API key (for AI features)
- HuggingFace API key (for alternative AI features)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/multi-proyecto-api.git
   cd multi-proyecto-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the example environment file and update with your configuration:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your database credentials and other settings.

5. Run database migrations:
   ```bash
   npm run migrate:latest
   ```

6. Seed the database with initial data (optional):
   ```bash
   npm run seed:run
   ```

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server
NODE_ENV=development
PORT=3000
APP_NAME="Multi-Project API"
APP_URL=http://localhost:3000
API_PREFIX=/api/v1

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=multiproyecto
DB_USER=postgres
DB_PASSWORD=postgres
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# JWT
JWT_SECRET=your_jwt_secret
JWT_EXPIRE=1h
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_REFRESH_EXPIRE=7d

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=user@example.com
SMTP_PASSWORD=your_smtp_password
EMAIL_FROM="Multi-Project API <noreply@example.com>"
SUPPORT_EMAIL=support@example.com

# AI
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4
HUGGINGFACE_API_KEY=your_huggingface_api_key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX=100  # Max requests per window

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:8080

# Logging
LOG_LEVEL=info
LOG_TO_FILE=true

# File Uploads
MAX_FILE_SIZE=10485760  # 10MB
UPLOAD_DIR=./uploads
```

## API Documentation

API documentation is available at `/api-docs` when running the application in development mode.

To generate API documentation:

1. Install the Swagger CLI:
   ```bash
   npm install -g swagger-cli
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Access the API documentation at `http://localhost:3000/api-docs`

## Available Scripts

- `npm start`: Start the production server
- `npm run dev`: Start the development server with hot-reload
- `npm test`: Run tests
- `npm run test:watch`: Run tests in watch mode
- `npm run lint`: Run ESLint
- `npm run lint:fix`: Fix ESLint issues
- `npm run typecheck`: Run TypeScript type checking
- `npm run migrate:make <name>`: Create a new migration
- `npm run migrate:latest`: Run pending migrations
- `npm run migrate:rollback`: Rollback the latest migration
- `npm run seed:run`: Run database seeds
- `npm run build`: Build the application for production
- `npm run docs:generate`: Generate API documentation

## Project Structure

```
src/
├── config/               # Configuration files
├── controllers/          # Request handlers
├── middleware/           # Express middleware
├── models/               # Database models
├── routes/               # API routes
├── services/             # Business logic
├── utils/                # Utility functions
├── validators/           # Request validation schemas
├── app.js                # Express application
└── server.js             # Server entry point
```

## Database Schema

### Users
- id (UUID)
- email (String, unique)
- password_hash (String)
- first_name (String)
- last_name (String)
- is_active (Boolean)
- email_verified (Boolean)
- created_at (Timestamp)
- updated_at (Timestamp)

### Projects
- id (UUID)
- name (String)
- slug (String, unique)
- description (Text, nullable)
- is_public (Boolean)
- is_active (Boolean)
- created_by (UUID, foreign key to Users)
- created_at (Timestamp)
- updated_at (Timestamp)

### Project Members
- id (UUID)
- project_id (UUID, foreign key to Projects)
- user_id (UUID, foreign key to Users)
- role (Enum: 'user', 'editor', 'admin')
- added_by (UUID, foreign key to Users)
- created_at (Timestamp)
- updated_at (Timestamp)

### Project Databases
- id (UUID)
- project_id (UUID, foreign key to Projects)
- name (String)
- description (Text, nullable)
- type (Enum: 'postgresql', 'mysql', 'mongodb', 'sqlite', 'mssql')
- connection_config (JSON)
- is_primary (Boolean)
- is_active (Boolean)
- created_by (UUID, foreign key to Users)
- created_at (Timestamp)
- updated_at (Timestamp)

### Query History
- id (UUID)
- user_id (UUID, foreign key to Users)
- project_id (UUID, foreign key to Projects)
- database_id (UUID, foreign key to Project Databases, nullable)
- query (Text)
- params (JSON, nullable)
- result_metadata (JSON, nullable)
- is_ai_generated (Boolean)
- created_at (Timestamp)

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. To authenticate a request, include the JWT token in the `Authorization` header:

```
Authorization: Bearer <token>
```

### Obtaining a Token

1. **Login** (POST `/api/v1/auth/login`):
   ```json
   {
     "identifier": "user@example.com",
     "password": "password123"
   }
   ```

2. **Response**:
   ```json
   {
     "success": true,
     "data": {
       "user": {
         "id": "550e8400-e29b-41d4-a716-446655440000",
         "email": "user@example.com",
         "first_name": "John",
         "last_name": "Doe"
       },
       "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
       "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
     }
   }
   ```

## Error Handling

All error responses follow the same format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse. By default, clients are limited to 100 requests per 15-minute window. The following headers are included in rate-limited responses:

- `X-RateLimit-Limit`: The maximum number of requests allowed in the window
- `X-RateLimit-Remaining`: The number of requests remaining in the current window
- `X-RateLimit-Reset`: The time at which the current window resets (UTC epoch seconds)

## Caching

Responses may be cached using ETags. Clients can send an `If-None-Match` header with the ETag value to check if the resource has been modified. If the resource hasn't changed, the API will return a `304 Not Modified` response.

## Webhooks

Webhooks can be configured to receive notifications for various events (e.g., new user registration, project updates). Webhook endpoints should be registered in the application settings.

## Deployment

### Docker

1. Build the Docker image:
   ```bash
   docker build -t multi-proyecto-api .
   ```

2. Run the container:
   ```bash
   docker run -d \
     --name multi-proyecto-api \
     -p 3000:3000 \
     --env-file .env \
     multi-proyecto-api
   ```

### Kubernetes

Example Kubernetes deployment configuration:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: multi-proyecto-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: multi-proyecto-api
  template:
    metadata:
      labels:
        app: multi-proyecto-api
    spec:
      containers:
      - name: multi-proyecto-api
        image: multi-proyecto-api:latest
        ports:
        - containerPort: 3000
        envFrom:
        - secretRef:
            name: multi-proyecto-api-secrets
        - configMapRef:
            name: multi-proyecto-api-config
        resources:
          limits:
            cpu: "1"
            memory: "512Mi"
          requests:
            cpu: "0.5"
            memory: "256Mi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, please contact [support@example.com](mailto:support@example.com).
