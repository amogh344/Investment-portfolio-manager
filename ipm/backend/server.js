import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import investmentRoutes from './routes/InvestmentRoutes.js';

dotenv.config();
connectDB(); // Connect to MongoDB

const app = express();
const PORT = process.env.PORT || 5050;

// CORS Setup (Allow frontend access)
app.use(cors({ origin: 'http://localhost:3000' }));

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/investments', investmentRoutes);

// Health check route
app.get('/', (req, res) => {
  res.send('✅ Investment Portfolio Dashboard API is running.');
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});