const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const authRoutes = require('./auth');
const userRoutes = require('./users');
const projectRoutes = require('./projects');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to Database
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
