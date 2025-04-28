import mongoose from 'mongoose';

const InvestmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  symbol: { type: String }, // For stocks/crypto symbols
  quantity: { type: Number, required: true },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  purchasePrice: { type: Number }, // Price per unit at purchase
  currentPrice: { type: Number }, // Current price per unit
  profitLoss: { type: Number }, // Current P&L
  profitLossPercentage: { type: Number }, // P&L as percentage
  lastUpdated: { type: Date, default: Date.now }, // Track when prices were last updated
  notes: { type: String }, // Optional notes about the investment
  tags: [{ type: String }], // Custom tags for categorization
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Add an index for better query performance
InvestmentSchema.index({ type: 1, name: 1 });

const Investment = mongoose.model('Investment', InvestmentSchema);

export default Investment;