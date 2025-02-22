const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const WebSocket = require("ws");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const http = require("http");

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

const sendNotification = async (message) => {
  try {
    await pool.execute(
      "INSERT INTO notifications (type, message, createdAt) VALUES (?, ?, NOW())",
      [message.type, message.message]
    );

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  } catch (error) {
    console.error("Notification Error:", error);
  }
};

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
    console.error("Registration Error:", error);
    res
      .status(500)
      .json({ message: "Registration failed", error: error.message });
  }
});

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
    console.error("Login Error:", error);
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

app.post("/customers", async (req, res) => {
  const { name, contact, outstandingAmount, dueDate, paymentStatus } = req.body;
  try {
    await pool.execute(
      "INSERT INTO customers (name, contact, outstandingAmount, dueDate, paymentStatus) VALUES (?, ?, ?, ?, ?)",
      [name, contact, outstandingAmount, dueDate, paymentStatus]
    );

    await sendNotification({
      type: "customer_added",
      message: `New customer ${name} added successfully`,
    });

    res.json({ message: "Customer added successfully" });
  } catch (error) {
    console.error("Customer Add Error:", error);
    res
      .status(500)
      .json({ message: "Failed to add customer", error: error.message });
  }
});

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

app.delete("/customers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute("DELETE FROM customers WHERE id = ?", [id]);
    res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error deleting customer", error: error.message });
  }
});

app.put("/customers/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: "Name is required" });
  }

  try {
    await pool.execute("UPDATE customers SET name = ? WHERE id = ?", [
      name,
      id,
    ]);
    res.json({ message: "Customer name updated successfully" });
  } catch (error) {
    console.error("Error updating customer:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/payments", async (req, res) => {
  const { customerId, amount } = req.body;

  try {
    await pool.execute(
      "INSERT INTO payments (customerId, amount, paymentDate) VALUES (?, ?, NOW())",
      [customerId, amount]
    );

    await pool.execute("UPDATE customers SET paymentStatus = ? WHERE id = ?", [
      "Completed",
      customerId,
    ]);

    await sendNotification({
      type: "payment_received",
      message: `Payment of $${amount} received for Customer ID ${customerId}`,
    });

    res.json({ message: "Payment processed successfully" });
  } catch (error) {
    console.error("Payment Error:", error);
    res
      .status(500)
      .json({ message: "Payment processing failed", error: error.message });
  }
});

app.get("/notifications", async (req, res) => {
  try {
    const [notifications] = await pool.execute(
      "SELECT * FROM notifications ORDER BY createdAt DESC"
    );
    res.json(notifications);
  } catch (error) {
    console.error("Notification Fetch Error:", error);
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
