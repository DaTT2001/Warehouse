require("dotenv").config();
const moment = require("moment-timezone");

const now = moment().tz("Asia/Ho_Chi_Minh").format("YYYY-MM-DD HH:mm:ss");

const express = require("express");
const fs = require("fs");
const jwt = require('jsonwebtoken');
const cors = require('cors');
const https = require("https");

const { Client } = require("pg");

const app = express();

const port = 3000;
app.use(express.json()); // Middleware để Express có thể đọc body request dạng JSON
app.use(cors({
  origin: '*', // '*' cho phép tất cả các nguồn
  methods: 'GET,POST,PUT,DELETE', // Các phương thức được phép
  allowedHeaders: 'Content-Type,Authorization', // Các headers được phép
  credentials: false // Nếu không cần gửi cookie, set là false
}));
// Cấu hình kết nối với PostgreSQL
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
// Kết nối với PostgreSQL
client
  .connect()
  .then(() => console.log("Kết nối đến PostgreSQL thành công"))
  .catch((err) => console.error("Lỗi kết nối:", err));

//Login, logout
// Đăng nhập API
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // Kiểm tra xem user có tồn tại không
    const userQuery = 'SELECT * FROM public.users WHERE username = $1';
    const result = await client.query(userQuery, [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Kiểm tra mật khẩu
    if (password !== user.passwordhash) {
      return res.status(401).json({ error: "Invalid username or password" });
    }  
    const token = jwt.sign(
      { fullname: user.fullname, username: user.username, role: user.role },
      'secretkey', // Bạn có thể thay đổi 'secretkey' thành một chuỗi bảo mật khác
      { expiresIn: '30m' } // Token hết hạn sau 10 phút
    );

    res.json({ token });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Middleware xác thực token và cập nhật thời gian hết hạn mỗi khi có yêu cầu hợp lệ
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Kiểm tra token hợp lệ
  jwt.verify(token, 'secretkey', (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }

    // Token hợp lệ, tiếp tục yêu cầu và cập nhật token
    // Tạo token mới với thời gian hết hạn 10 phút kể từ thời điểm hiện tại
    const newToken = jwt.sign(
      { fullname: decoded.fullname, username: decoded.username, role: decoded.role },
      'secretkey',
      { expiresIn: '30m' } // Token hết hạn sau 10 phút
    );

    // Đưa token mới vào response headers
    res.setHeader('x-new-token', newToken);

    req.user = decoded;
    next();
  });
};

// Middleware kiểm tra quyền dựa trên role
const authorize = (roles) => {
  return (req, res, next) => {
    const user = req.user; // Đảm bảo rằng user đã được xác thực trong authenticate

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Kiểm tra nếu user có role phù hợp
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next(); // Nếu role hợp lệ, cho phép truy cập API
  };
};

// API protected chỉ có thể truy cập nếu đã đăng nhập và có token hợp lệ
app.get('/protected', authenticate, (req, res) => {
  res.json({ message: 'You have access to this protected route', user: req.user });
});

// Test API yêu cầu xác thực
app.get('/protected', authenticate, (req, res) => {
  res.json({ message: 'You have access to this protected route', user: req.user });
});


//Products API start
// API GET để lấy dữ liệu từ bảng
app.get("/products",authenticate, async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM Products");
    res.json(result.rows);
  } catch (err) {
    console.error("Lỗi khi truy vấn dữ liệu:", err);
    res.status(500).send("Lỗi server");
  }
});
// API lấy tất cả sản phẩm
app.get("/products",authenticate, async (req, res) => {
  try {
    const query = "SELECT * FROM public.products";
    const result = await client.query(query);
    res.json(result.rows); // Trả về danh sách sản phẩm
  } catch (err) {
    console.error("Error fetching products:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// API thêm sản phẩm mới
app.post("/products",authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const { productid, productname, unit, price, quantity, supplierid } = req.body;

  // Kiểm tra xem tất cả các trường có được cung cấp hay không
  if (
    !productid ||
    !productname ||
    !unit ||
    price === undefined ||
    quantity === undefined ||
    supplierid === undefined
  ) {
    return res
      .status(400)
      .json({
        error:
          "All fields (productid, productname, unit, price, quantity, supplierid) are required",
      });
  }

  try {
    // Kiểm tra xem productid có bị trùng không, id của nhà cung cấp có đúng không
    const checkQuery = "SELECT * FROM public.products WHERE productid = $1";
    const checkResult = await client.query(checkQuery, [productid]);
    const supplierCheckQuery = "SELECT * FROM public.suppliers WHERE supplierid = $1";
    const supplierCheckResult = await client.query(supplierCheckQuery, [supplierid]);

    if (supplierCheckResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid supplierid, supplier does not exist" });
    }

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: "Product ID already exists" });
    }

    // Cập nhật câu lệnh INSERT để thêm quantity
    const query = `
        INSERT INTO public.products (productid, productname, unit, price, quantity, supplierid)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
      `;
    const values = [productid, productname, unit, price, quantity, supplierid];
    const result = await client.query(query, values);

    res.status(201).json(result.rows[0]); // Trả về sản phẩm đã được tạo
  } catch (err) {
    console.error("Error creating product:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// API sửa thông tin sản phẩm
app.put("/products/:id", authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const productid = req.params.id;
  const { productname, unit, price, quantity, supplierid } = req.body;
  

  if (!productname || !unit || price === undefined || quantity === undefined || supplierid === undefined) {
    return res
      .status(400)
      .json({
        error: "All fields (productname, unit, price, quantity, supplierid) are required",
      });
  }

  try {

    //Kiểm tra id nhà cung cấp có đúng không
    const supplierCheckQuery = "SELECT * FROM public.suppliers WHERE supplierid = $1";
    const supplierCheckResult = await client.query(supplierCheckQuery, [supplierid]);

    if (supplierCheckResult.rows.length === 0) {
      return res.status(400).json({ error: "Invalid supplierid, supplier does not exist" });
    }

    const query = `
        UPDATE public.products
        SET productname = $1, unit = $2, price = $3, quantity = $4, supplierid = $5
        WHERE productid = $6
        RETURNING *;
      `;
    const values = [productname, unit, price, quantity, supplierid, productid];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json(result.rows[0]); // Trả về sản phẩm đã được cập nhật
  } catch (err) {
    console.error("Error updating product:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// API xóa sản phẩm
app.delete('/products/:id',authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const productid = req.params.id;

  try {
    // Kiểm tra xem sản phẩm có tồn tại không
    const checkQuery = 'SELECT * FROM public.products WHERE productid = $1';
    const checkResult = await client.query(checkQuery, [productid]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Xóa sản phẩm
    const query = 'DELETE FROM public.products WHERE productid = $1 RETURNING *';
    const result = await client.query(query, [productid]);

    res.status(200).json({ message: 'Product deleted successfully', deletedProduct: result.rows[0] });
  } catch (err) {
    console.error('Error deleting product:', err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//Products API end

//Supplier API Start
//Lấy tất cả dữ liệu về
app.get("/suppliers", authenticate, async (req, res) => {
  try {
    const query = "SELECT * FROM public.suppliers";
    const result = await client.query(query);
    res.json(result.rows); // Trả về danh sách sản phẩm
  } catch (err) {
    console.error("Error fetching suppliers:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
//Thêm nhà cung cấp mới
app.post("/suppliers", authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const { suppliername, contactname, phone, email, address } = req.body;

  // Kiểm tra nếu thiếu tên nhà cung cấp
  if (!suppliername) {
    return res.status(400).json({ error: "Tên nhà cung cấp không được để trống!" });
  }

  try {
    // Kiểm tra xem suppliername, email hoặc phone có bị trùng không
    const checkDuplicateQuery = `
      SELECT * FROM public.suppliers 
      WHERE suppliername = $1 OR email = $2 OR phone = $3
    `;
    const duplicateCheck = await client.query(checkDuplicateQuery, [suppliername, email, phone]);

    if (duplicateCheck.rows.length > 0) {
      let errorMessage = "Nhà cung cấp đã tồn tại với thông tin sau: ";

      duplicateCheck.rows.forEach((row) => {
        if (row.suppliername === suppliername) errorMessage += "Tên nhà cung cấp trùng. ";
        if (row.email === email) errorMessage += "Email trùng. ";
        if (row.phone === phone) errorMessage += "Số điện thoại trùng. ";
      });

      return res.status(400).json({ error: errorMessage.trim() });
    }

    // Nếu không trùng, thêm nhà cung cấp mới
    const insertQuery = `
      INSERT INTO public.suppliers (suppliername, contactname, phone, email, address)
      VALUES ($1, $2, $3, $4, $5) RETURNING *;
    `;
    const values = [suppliername, contactname || null, phone || null, email || null, address || null];

    const result = await client.query(insertQuery, values);
    res.status(201).json(result.rows[0]); // Trả về dữ liệu vừa thêm
  } catch (err) {
    console.error("Lỗi khi thêm nhà cung cấp:", err.stack);
    res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
  }
});

//Sửa nhà cung cấp

app.put("/suppliers/:id", authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const supplierid = req.params.id;
  const { suppliername, contactname, phone, email, address } = req.body;

  // Kiểm tra nếu thiếu thông tin bắt buộc
  if (!suppliername || !contactname || !phone || !email || !address) {
    return res.status(400).json({ error: "Tất cả các trường đều là bắt buộc!" });
  }

  try {
    // Kiểm tra xem supplierid có tồn tại không
    const checkSupplierQuery = "SELECT * FROM public.suppliers WHERE supplierid = $1";
    const supplierCheckResult = await client.query(checkSupplierQuery, [supplierid]);

    if (supplierCheckResult.rows.length === 0) {
      return res.status(404).json({ error: "Nhà cung cấp không tồn tại!" });
    }

    // Kiểm tra xem suppliername, email hoặc phone có bị trùng với nhà cung cấp khác không
    const checkDuplicateQuery = `
      SELECT * FROM public.suppliers 
      WHERE (suppliername = $1 OR email = $2 OR phone = $3) AND supplierid <> $4
    `;
    const duplicateCheck = await client.query(checkDuplicateQuery, [suppliername, email, phone, supplierid]);

    if (duplicateCheck.rows.length > 0) {
      let errorMessage = "Thông tin trùng lặp với nhà cung cấp khác: ";

      duplicateCheck.rows.forEach((row) => {
        if (row.suppliername === suppliername) errorMessage += "Tên nhà cung cấp trùng. ";
        if (row.email === email) errorMessage += "Email trùng. ";
        if (row.phone === phone) errorMessage += "Số điện thoại trùng. ";
      });

      return res.status(400).json({ error: errorMessage.trim() });
    }

    // Nếu không trùng, tiến hành cập nhật nhà cung cấp
    const updateQuery = `
      UPDATE public.suppliers
      SET suppliername = $1, contactname = $2, phone = $3, email = $4, address = $5
      WHERE supplierid = $6
      RETURNING *;
    `;
    const values = [suppliername, contactname, phone, email, address, supplierid];

    const result = await client.query(updateQuery, values);

    res.status(200).json(result.rows[0]); // Trả về dữ liệu sau khi cập nhật thành công
  } catch (err) {
    console.error("Lỗi khi cập nhật nhà cung cấp:", err.stack);
    res.status(500).json({ error: "Lỗi máy chủ nội bộ" });
  }
});

//Xóa nhà cung cấp: 
app.delete('/suppliers/:id', authenticate, authorize(['Admin', 'Warehouse_Manager']), async (req, res) => {
  const supplierid = req.params.id;

  try {
    // Kiểm tra xem nhà cung cấp có tồn tại không
    const checkQuery = 'SELECT * FROM public.suppliers WHERE supplierid = $1';
    const checkResult = await client.query(checkQuery, [supplierid]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier ID not found' });
    }

    // Kiểm tra xem có sản phẩm nào của nhà cung cấp này không
    const productCheckQuery = 'SELECT * FROM public.products WHERE supplierid = $1';
    const productCheckResult = await client.query(productCheckQuery, [supplierid]);

    if (productCheckResult.rows.length > 0) {
      return res.status(400).json({ error: 'Cannot delete supplier, products exist for this supplier' });
    }

    // Xóa nhà cung cấp
    const deleteSupplierQuery = 'DELETE FROM public.suppliers WHERE supplierid = $1 RETURNING *';
    const result = await client.query(deleteSupplierQuery, [supplierid]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.status(200).json({ message: 'Supplier deleted successfully', deletedSupplier: result.rows[0] });
  } catch (err) {
    console.error('Error deleting supplier:', err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//Api luu log, lay log
app.post("/logs", async (req, res) => {
  const { username, action } = req.body;

  if (!username || !action) {
    return res.status(400).json({ error: "Thiếu thông tin username hoặc action" });
  }

  try {
    const result = await client.query(
      "INSERT INTO user_logs (username, action) VALUES ($1, $2) RETURNING *",
      [username, action]
    );
    res.status(200).json({ message: "Log saved", log: result.rows[0] });
  } catch (err) {
    console.error("Lỗi khi lưu log:", err);
    res.status(500).send("Lỗi server");
  }
});


app.get("/logs", async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM user_logs ORDER BY timestamp DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Lỗi khi truy vấn log:", err);
    res.status(500).send("Lỗi server");
  }
});

//api luu don orders

app.post("/orders", authenticate, async (req, res) => {
  const { employee_name, employee_id, role, productid, productname, quantity, type, timestamp } = req.body;

  // Kiểm tra dữ liệu đầu vào
  if (!employee_name || !employee_id || !role || !productid || !productname || !quantity || !type) {
    return res.status(400).json({ error: "Thiếu thông tin đơn hàng" });
  }

  // Kiểm tra type hợp lệ (chỉ nhận 'Add' hoặc 'Export')
  if (!["Add", "Export"].includes(type)) {
    return res.status(400).json({ error: "Loại đơn hàng không hợp lệ (chỉ nhận 'Add' hoặc 'Export')" });
  }

  try {
    // Lưu đơn hàng vào PostgreSQL
    await client.query(
      `INSERT INTO orders (employee_name, employee_id, role, productid, productname, quantity, type, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [employee_name, employee_id, role, productid, productname, quantity, type, timestamp || new Date().toISOString()]
    );

    res.status(201).json({ message: "Lưu đơn hàng thành công" });
  } catch (error) {
    console.error("❌ Lỗi lưu đơn hàng:", error.message);
    res.status(500).json({ error: "Lỗi server khi lưu đơn hàng" });
  }
});

app.get("/orders", authenticate, async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM orders ORDER BY timestamp DESC");
    res.json(result.rows); // Trả về danh sách đơn hàng
  } catch (err) {
    console.error("Lỗi khi truy vấn đơn hàng:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// API lấy sản phẩm theo productid
app.get("/products/:id", authenticate, async (req, res) => {
  const productid = req.params.id;

  try {
    const query = "SELECT * FROM public.products WHERE productid = $1";
    const result = await client.query(query, [productid]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(result.rows[0]); // Trả về sản phẩm
  } catch (err) {
    console.error("Lỗi khi truy vấn sản phẩm:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// API xóa đơn hàng theo id
app.delete("/orders/:id", authenticate, async (req, res) => {
  const orderId = req.params.id;

  try {
    // Kiểm tra xem đơn hàng có tồn tại không
    const checkQuery = "SELECT * FROM orders WHERE id = $1";
    const checkResult = await client.query(checkQuery, [orderId]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Xóa đơn hàng
    const deleteQuery = "DELETE FROM orders WHERE id = $1 RETURNING *";
    const result = await client.query(deleteQuery, [orderId]);

    res.status(200).json({ message: "Order deleted successfully", deletedOrder: result.rows[0] });
  } catch (err) {
    console.error("Lỗi khi xóa đơn hàng:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// Khởi chạy server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});