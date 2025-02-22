const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const WebSocket = require("ws");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const http = require("http");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.SECRET_KEY;

const multer = require("multer");
const xlsx = require("xlsx");
const storage = multer.memoryStorage();
const upload = multer({ storage });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Customer Management API",
      version: "1.0.0",
      description: "API for managing customers, payments, and notifications",
    },
    servers: [
      {
        url: "http://localhost:5000",
        description: "Local development server",
      },
    ],
  },
  apis: ["./src/server.js"],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

console.log("Swagger API docs available at http://localhost:5000/api-docs");

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: User registered successfully
 */
app.post("/register", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );

    res.json({ message: "User registered successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Registration failed", error: error.message });
  }
});

/**
 * @swagger
 * /login:
 *   post:
 *     summary: User login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Returns JWT token
 *       401:
 *         description: Invalid credentials
 */
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    if (rows.length && (await bcrypt.compare(password, rows[0].password))) {
      const token = jwt.sign({ id: rows[0].id }, SECRET_KEY);
      res.json({ token });
    } else {
      res.status(401).json({ message: "Invalid credentials" });
    }
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

/**
 * @swagger
 * /customers:
 *   post:
 *     summary: Add a new customer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               contact:
 *                 type: string
 *               outstandingAmount:
 *                 type: number
 *               dueDate:
 *                 type: string
 *                 format: date
 *               paymentStatus:
 *                 type: string
 *     responses:
 *       200:
 *         description: Customer added successfully
 */
app.post("/customers", async (req, res) => {
  const { name, contact, outstandingAmount, dueDate, paymentStatus } = req.body;
  try {
    await pool.execute(
      "INSERT INTO customers (name, contact, outstandingAmount, dueDate, paymentStatus) VALUES (?, ?, ?, ?, ?)",
      [name, contact, outstandingAmount, dueDate, paymentStatus]
    );
    res.json({ message: "Customer added successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to add customer", error: error.message });
  }
});

/**
 * @swagger
 * /customers:
 *   get:
 *     summary: Get all customers
 *     responses:
 *       200:
 *         description: Returns a list of customers
 */
app.get("/customers", async (req, res) => {
  try {
    const [customers] = await pool.execute("SELECT * FROM customers");
    res.json(customers);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching customers", error: error.message });
  }
});

/**
 * @swagger
 * /payments:
 *   post:
 *     summary: Process a payment for a customer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customerId:
 *                 type: integer
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Payment processed successfully
 */
app.post("/payments", async (req, res) => {
  const { customerId, amount } = req.body;
  try {
    await pool.execute(
      "INSERT INTO payments (customerId, amount, paymentDate) VALUES (?, ?, NOW())",
      [customerId, amount]
    );
    res.json({ message: "Payment processed successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Payment processing failed", error: error.message });
  }
});

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get all notifications
 *     responses:
 *       200:
 *         description: Returns a list of notifications
 */
app.get("/notifications", async (req, res) => {
  try {
    const [notifications] = await pool.execute(
      "SELECT * FROM notifications ORDER BY createdAt DESC"
    );
    res.json(notifications);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch notifications", error: error.message });
  }
});

const checkOverduePayments = async () => {
  try {
    const [overdueCustomers] = await pool.execute(
      'SELECT id, name FROM customers WHERE paymentStatus = "Pending" AND dueDate < NOW()'
    );

    overdueCustomers.forEach(async (customer) => {
      await sendNotification({
        type: "payment_overdue",
        message: `Payment overdue for Customer: ${customer.name} (ID: ${customer.id})`,
      });
    });
  } catch (error) {
    console.error("Overdue Payment Check Error:", error);
  }
};
setInterval(checkOverduePayments, 3600000);

/**
 * @swagger
 * /upload-customers:
 *   post:
 *     summary: Upload customers from an Excel file
 *     description: Accepts an Excel file (.xlsx) containing customer details and inserts them into the database.
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Customers uploaded successfully
 */
app.post("/upload-customers", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      for (const row of data) {
        const {
          Name,
          Contact,
          "Outstanding Amount": outstandingAmount,
          "Due Date": dueDate,
          "Payment Status": paymentStatus,
        } = row;

        await connection.execute(
          "INSERT INTO customers (name, contact, outstandingAmount, dueDate, paymentStatus) VALUES (?, ?, ?, ?, ?)",
          [Name, Contact, outstandingAmount, dueDate, paymentStatus]
        );
      }

      await connection.commit();
      res.json({ message: "Customers uploaded successfully" });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("File Upload Error:", error);
    res
      .status(500)
      .json({ message: "Failed to process file", error: error.message });
  }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
