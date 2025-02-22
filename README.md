# Customer Management API

## 📌 Project Overview
The **Customer Management API** is a backend system designed to manage customer records, process payments, and send notifications for overdue invoices. It provides user authentication, customer data management, payment processing, and bulk customer uploads via Excel files.

### **Key Features**
- ✅ **User Authentication** (Register/Login with JWT)
- ✅ **Customer Management** (Add, Retrieve, Bulk Upload Customers)
- ✅ **Payment Processing** (Record Payments)
- ✅ **Automated Notifications** (Overdue Payment Alerts)
- ✅ **Swagger API Documentation** (`/api-docs`)
- ✅ **WebSockets Integration** (For real-time notifications)
- ✅ **Docker Support** (For containerized deployment)

---

## 🚀 Setup Instructions

### **Clone the Repository**
git clone https://github.com/Gayathri-Mallimoggala/backend
cd backend
npm install

Configure Environment Variables

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=prasad947
DB_NAME=customer_db
SECRET_KEY=supersecretkey
PORT=5000

Run Database Migrations

node src/migrations/setupDatabase.js

npm start


The API will be available at:
📌 http://localhost:5000

Swagger API Docs:
📌 http://localhost:5000/api-docs


Architecture Diagram

+---------------------+     +------------+     +-----------+
|   Frontend (Reactjs)| --> |  Backend   | --> |  MySQL DB |
|                     |     | (Node js)  |     |           |
+---------------------+     +------------+     +-----------+


⚙️ Technical Decisions Explanation
1️⃣ Express.js for API Development
Chosen for its minimal and flexible nature.
Easy integration with middleware like cors, jsonwebtoken, multer, and mysql2.
2️⃣ MySQL for Data Storage
Relational database ensures structured storage of customer and payment data.
Supports transactions for bulk operations (e.g., Excel file uploads).
3️⃣ JWT for Authentication
Secure user authentication using JSON Web Tokens (JWT).
Ensures only authenticated users can access the API.
4️⃣ Multer & xlsx for Bulk Upload
Uses multer to handle file uploads.
Reads Excel sheets using xlsx and inserts data into MySQL.
5️⃣ WebSockets for Real-Time Notifications
Uses ws (WebSockets) to send notifications for overdue payments.
Runs a scheduled job to check overdue payments and send alerts.
6️⃣ Swagger for API Documentation
Provides interactive documentation for testing API endpoints.

🔥 Future Improvements
✅ Role-based authentication (Admin & Users)
✅ Email notifications for overdue payments
✅ Caching for faster API responses
✅ Pagination & Filtering for customer lists
✅ GraphQL Support for optimized queries

🤝 Contributors
Gayathri Mallimoggala (https://github.com/Gayathri-Mallimoggala)

