const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.SECRET_KEY;

// ✅ MySQL Database Connection
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ✅ Create HTTP server for Express
const server = http.createServer(app);

// ✅ WebSocket Server
const wss = new WebSocket.Server({ server });

// ✅ Function to send WebSocket notifications & Store in DB
const sendNotification = async (message) => {
  try {
    // ✅ Store notification in the database
    await pool.execute(
      'INSERT INTO notifications (type, message, createdAt) VALUES (?, ?, NOW())',
      [message.type, message.message]
    );

    // ✅ Send notification to WebSocket clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  } catch (error) {
    console.error('Notification Error:', error);
  }
};

// ✅ Authentication Routes
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword]);
    
    res.json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration Error:', error);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length && await bcrypt.compare(password, rows[0].password)) {
      const token = jwt.sign({ id: rows[0].id }, SECRET_KEY); 

      res.json({ token });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

// ✅ Customer Management Routes
app.post('/customers', async (req, res) => {
  const { name, contact, outstandingAmount, dueDate, paymentStatus } = req.body;
  try {
    await pool.execute(
      'INSERT INTO customers (name, contact, outstandingAmount, dueDate, paymentStatus) VALUES (?, ?, ?, ?, ?)', 
      [name, contact, outstandingAmount, dueDate, paymentStatus]
    );

    await sendNotification({ type: 'customer_added', message: `New customer ${name} added successfully` });

    res.json({ message: 'Customer added successfully' });
  } catch (error) {
    console.error('Customer Add Error:', error);
    res.status(500).json({ message: 'Failed to add customer', error: error.message });
  }
});

// ✅ Get all customers
app.get('/customers', async (req, res) => {
  try {
    const [customers] = await pool.execute('SELECT * FROM customers');
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching customers', error: error.message });
  }
});

// ✅ Get a single customer by ID
app.get('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [customer] = await pool.execute('SELECT * FROM customers WHERE id = ?', [id]);
    if (customer.length > 0) {
      res.json(customer[0]);
    } else {
      res.status(404).json({ message: 'Customer not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Error fetching customer', error: error.message });
  }
});

// ✅ Delete a customer
app.delete('/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM customers WHERE id = ?', [id]);
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting customer', error: error.message });
  }
});

// update customers by id successfully
app.put('/customers/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    await pool.execute('UPDATE customers SET name = ? WHERE id = ?', [name, id]);
    res.json({ message: 'Customer name updated successfully' });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/payments', async (req, res) => {
  const { customerId, amount } = req.body;

  try {
    await pool.execute(
      'INSERT INTO payments (customerId, amount, paymentDate) VALUES (?, ?, NOW())',
      [customerId, amount]
    );

    await pool.execute(
      'UPDATE customers SET paymentStatus = ? WHERE id = ?',
      ['Completed', customerId]
    );

    await sendNotification({ 
      type: 'payment_received', 
      message: `Payment of $${amount} received for Customer ID ${customerId}` 
    });

    res.json({ message: 'Payment processed successfully' });
  } catch (error) {
    console.error('Payment Error:', error);
    res.status(500).json({ message: 'Payment processing failed', error: error.message });
  }
});

// ✅ Get All Notifications
app.get('/notifications', async (req, res) => {
  try {
    const [notifications] = await pool.execute('SELECT * FROM notifications ORDER BY createdAt DESC');
    res.json(notifications);
  } catch (error) {
    console.error('Notification Fetch Error:', error);
    res.status(500).json({ message: 'Failed to fetch notifications', error: error.message });
  }
});

// ✅ Function to check overdue payments (runs every hour)
const checkOverduePayments = async () => {
  try {
    const [overdueCustomers] = await pool.execute(
      'SELECT id, name FROM customers WHERE paymentStatus = "Pending" AND dueDate < NOW()'
    );

    overdueCustomers.forEach(async (customer) => {
      await sendNotification({
        type: 'payment_overdue',
        message: `Payment overdue for Customer: ${customer.name} (ID: ${customer.id})`
      });
    });

  } catch (error) {
    console.error('Overdue Payment Check Error:', error);
  }
};

// ✅ Run overdue payment check every hour
setInterval(checkOverduePayments, 3600000);

// ✅ Start Express Server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
