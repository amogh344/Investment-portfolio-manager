import express from 'express';
import Investment from '../models/InvestmentModel.js';
import axios from 'axios';

const router = express.Router();

// Function to fetch USD to INR conversion rate with caching
let usdToInrCache = { rate: null, timestamp: null };
async function getUSDtoINR() {
  // Cache for 1 hour
  if (usdToInrCache.rate && Date.now() - usdToInrCache.timestamp < 3600000) {
    return usdToInrCache.rate;
  }

  try {
    const { data } = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
    usdToInrCache = { rate: data.rates.INR, timestamp: Date.now() };
    return data.rates.INR || null;
  } catch (error) {
    console.error('Error fetching USD to INR rate:', error);
    return usdToInrCache.rate || null;
  }
}

// Function to fetch crypto price from CoinGecko with retry
async function getCryptoPrice(coinId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: {
          ids: coinId,
          vs_currencies: 'usd',
          include_24hr_change: true,
          include_last_updated_at: true
        }
      });
      return {
        price: data[coinId]?.usd || null,
        change24h: data[coinId]?.usd_24h_change || null,
        lastUpdated: data[coinId]?.last_updated_at || null
      };
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

// Function to fetch stock price with improved error handling
async function getStockPrice(stockSymbol) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error('Alpha Vantage API key not configured');
  }

  try {
    const { data } = await axios.get('https://www.alphavantage.co/query', {
      params: {
        function: 'GLOBAL_QUOTE',
        symbol: stockSymbol,
        apikey: apiKey
      }
    });

    if (data['Error Message']) {
      throw new Error(data['Error Message']);
    }

    const quote = data['Global Quote'];
    return {
      price: parseFloat(quote['05. price']) || null,
      change24h: parseFloat(quote['09. change']) || null,
      changePercent: parseFloat(quote['10. change percent'].replace('%', '')) || null,
      lastUpdated: new Date(quote['07. latest trading day']).getTime()
    };
  } catch (error) {
    console.error(`Error fetching stock price for ${stockSymbol}:`, error);
    throw error;
  }
}

// Helper function to calculate investment metrics
function calculateMetrics(currentPrice, purchasePrice, quantity) {
  const profitLoss = (currentPrice - purchasePrice) * quantity;
  const profitLossPercentage = ((currentPrice - purchasePrice) / purchasePrice) * 100;
  return { profitLoss, profitLossPercentage };
}

// @route   GET /api/investments
// @desc    Get all investments with optional filters
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { type, sort, tags } = req.query;
    let query = {};
    
    // Apply filters
    if (type) query.type = type;
    if (tags) query.tags = { $in: tags.split(',') };

    // Build sort object
    let sortObj = {};
    if (sort) {
      const [field, order] = sort.split(':');
      sortObj[field] = order === 'desc' ? -1 : 1;
    } else {
      sortObj = { createdAt: -1 };
    }

    const investments = await Investment.find(query).sort(sortObj);
    res.json(investments);
  } catch (err) {
    console.error('Error fetching investments:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   POST /api/investments
// @desc    Add a new investment with real-time price
// @access  Public
router.post('/', async (req, res) => {
  try {
    const { name, symbol, quantity, type, notes, tags } = req.body;

    if (!name || !quantity || !type) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    let priceData = { price: 0, change24h: null };
    let usdToINR = await getUSDtoINR();

    if (type === 'Crypto') {
      const coinId = symbol?.toLowerCase() || name.toLowerCase();
      priceData = await getCryptoPrice(coinId);
    } else if (type === 'Stock') {
      const stockSymbol = symbol?.toUpperCase() || name.toUpperCase();
      priceData = await getStockPrice(stockSymbol);
    }

    if (!priceData.price) {
      return res.status(404).json({ message: `${type} price not found` });
    }

    const quantityNum = parseFloat(quantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      return res.status(400).json({ message: 'Invalid quantity' });
    }

    const amount = priceData.price * quantityNum * (usdToINR || 1);
    const metrics = calculateMetrics(priceData.price, priceData.price, quantityNum);

    const newInvestment = new Investment({
      name,
      symbol: symbol || name,
      quantity: quantityNum,
      type,
      amount,
      purchasePrice: priceData.price,
      currentPrice: priceData.price,
      profitLoss: metrics.profitLoss,
      profitLossPercentage: metrics.profitLossPercentage,
      lastUpdated: Date.now(),
      notes,
      tags
    });

    const savedInvestment = await newInvestment.save();
    res.json(savedInvestment);
  } catch (err) {
    console.error('Error saving investment:', err);
    res.status(500).json({ 
      message: 'Server Error', 
      error: err.message,
      details: err.response?.data 
    });
  }
});

// @route   PUT /api/investments/:id
// @desc    Update an existing investment
// @access  Public
router.put('/:id', async (req, res) => {
  try {
    const { name, symbol, quantity, type, notes, tags } = req.body;

    if (!name || !quantity || !type) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    let priceData = { price: 0, change24h: null };
    let usdToINR = await getUSDtoINR();

    if (type === 'Crypto') {
      const coinId = symbol?.toLowerCase() || name.toLowerCase();
      priceData = await getCryptoPrice(coinId);
    } else if (type === 'Stock') {
      const stockSymbol = symbol?.toUpperCase() || name.toUpperCase();
      priceData = await getStockPrice(stockSymbol);
    }

    if (!priceData.price) {
      return res.status(404).json({ message: `${type} price not found` });
    }

    const quantityNum = parseFloat(quantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      return res.status(400).json({ message: 'Invalid quantity' });
    }

    const amount = priceData.price * quantityNum * (usdToINR || 1);
    const existingInvestment = await Investment.findById(req.params.id);
    
    if (!existingInvestment) {
      return res.status(404).json({ message: 'Investment not found' });
    }

    const metrics = calculateMetrics(
      priceData.price,
      existingInvestment.purchasePrice || priceData.price,
      quantityNum
    );

    const updatedInvestment = await Investment.findByIdAndUpdate(
      req.params.id,
      {
        name,
        symbol: symbol || name,
        quantity: quantityNum,
        type,
        amount,
        currentPrice: priceData.price,
        profitLoss: metrics.profitLoss,
        profitLossPercentage: metrics.profitLossPercentage,
        lastUpdated: Date.now(),
        notes,
        tags
      },
      { new: true }
    );

    res.json(updatedInvestment);
  } catch (err) {
    console.error('Error updating investment:', err);
    res.status(500).json({ 
      message: 'Server Error', 
      error: err.message,
      details: err.response?.data 
    });
  }
});

// @route   GET /api/investments/update-prices
// @desc    Update prices for all investments
// @access  Public
router.get('/update-prices', async (req, res) => {
  try {
    const investments = await Investment.find();
    const usdToINR = await getUSDtoINR();
    const updates = [];

    for (const investment of investments) {
      try {
        let priceData = { price: 0, change24h: null };

        if (investment.type === 'Crypto') {
          const coinId = investment.symbol?.toLowerCase() || investment.name.toLowerCase();
          priceData = await getCryptoPrice(coinId);
        } else if (investment.type === 'Stock') {
          const stockSymbol = investment.symbol?.toUpperCase() || investment.name.toUpperCase();
          priceData = await getStockPrice(stockSymbol);
        }

        if (priceData.price) {
          const amount = priceData.price * investment.quantity * (usdToINR || 1);
          const metrics = calculateMetrics(
            priceData.price,
            investment.purchasePrice || priceData.price,
            investment.quantity
          );

          const update = await Investment.findByIdAndUpdate(
            investment._id,
            {
              amount,
              currentPrice: priceData.price,
              profitLoss: metrics.profitLoss,
              profitLossPercentage: metrics.profitLossPercentage,
              lastUpdated: Date.now()
            },
            { new: true }
          );
          updates.push(update);
        }
      } catch (error) {
        console.error(`Error updating ${investment.name}:`, error);
      }
    }

    res.json({ message: 'Prices updated successfully', updates });
  } catch (err) {
    console.error('Error updating prices:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

// @route   DELETE /api/investments/:id
// @desc    Delete an investment
// @access  Public
router.delete('/:id', async (req, res) => {
  try {
    const investment = await Investment.findByIdAndDelete(req.params.id);

    if (!investment) {
      return res.status(404).json({ message: 'Investment not found' });
    }

    res.json({ message: 'Investment removed', investment });
  } catch (err) {
    console.error('Error deleting investment:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

export default router;