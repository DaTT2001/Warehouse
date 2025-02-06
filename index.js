require("dotenv").config();
const express = require("express");
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');


const { Client } = require("pg");

const app = express();
const port = 3000;
app.use(express.json()); // Middleware để Express có thể đọc body request dạng JSON

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
    if (!password === user.passwordhash) {
      return res.status(401).json({ error: "Invalid username or password" });
    }  
    // Tạo token JWT mới với thời gian hết hạn là 10 phút từ bây giờ
    const token = jwt.sign(
      { userid: user.userid, username: user.username, role: user.role },
      'secretkey', // Bạn có thể thay đổi 'secretkey' thành một chuỗi bảo mật khác
      { expiresIn: '10m' } // Token hết hạn sau 10 phút
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
      { userid: decoded.userid, username: decoded.username, role: decoded.role },
      'secretkey',
      { expiresIn: '10m' } // Token hết hạn sau 10 phút
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
app.get("/products", async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM Products");
    res.json(result.rows);
  } catch (err) {
    console.error("Lỗi khi truy vấn dữ liệu:", err);
    res.status(500).send("Lỗi server");
  }
});
// API lấy tất cả sản phẩm
app.get("/products", async (req, res) => {
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
app.post("/products", async (req, res) => {
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
app.put("/products/:id", async (req, res) => {
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
app.get("/suppliers", async (req, res) => {
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
app.post("/suppliers", async (req, res) => {
  const { supplierid, suppliername, contactname, phone, email, address } = req.body;

  // Kiểm tra xem tất cả các trường có được cung cấp hay không
  if (
    !supplierid ||
    !suppliername ||
    !contactname ||
    phone === undefined ||
    email === undefined ||
    address === undefined
  ) {
    return res
      .status(400)
      .json({
        error:
          "All fields (supplierid, suppliername, contactname, phone, email, address) are required",
      });
  }

  try {
    // Kiểm tra xem id của nhà cung cấp có trùng không
    const supplierCheckQuery = "SELECT * FROM public.suppliers WHERE supplierid = $1";
    const supplierCheckResult = await client.query(supplierCheckQuery, [supplierid]);

    if (supplierCheckResult.rows.length > 0) {
      return res.status(400).json({ error: "Invalid supplierid, supplier does not exist" });
    }

    // Cập nhật câu lệnh INSERT để thêm quantity
    const query = `
        INSERT INTO public.suppliers (supplierid, suppliername, contactname, phone, email, address)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;
      `;
    const values = [supplierid, suppliername, contactname, phone, email, address];
    const result = await client.query(query, values);

    res.status(201).json(result.rows[0]); // Trả về nhà cung cấp đã được tạo
  } catch (err) {
    console.error("Error creating supplier:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
//Sửa nhà cung cấp
app.put("/suppliers/:id", async (req, res) => {
  const supplierid = req.params.id;
  const { suppliername, contactname, phone, email, address } = req.body;
  

  if (!suppliername || !contactname || phone === undefined || email === undefined || address === undefined) {
    return res
      .status(400)
      .json({
        error: "All fields are required",
      });
  }

  try {

    // const supplierCheckQuery = "SELECT * FROM public.suppliers WHERE supplierid = $1";
    // const supplierCheckResult = await client.query(supplierCheckQuery, [supplierid]);

    // if (supplierCheckResult.rows.length === 0) {
    //   return res.status(400).json({ error: "Invalid supplierid, supplier does not exist" });
    // }

    const query = `
        UPDATE public.suppliers
        SET suppliername = $1, contactname = $2, phone = $3, email = $4, address = $5
        WHERE supplierid = $6
        RETURNING *;
      `;
    const values = [suppliername, contactname, phone, email, address, supplierid];
    const result = await client.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json(result.rows[0]); // Trả về nhà cung cấp đã được cập nhật
  } catch (err) {
    console.error("Error updating supplier:", err.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
//Xóa nhà cung cấp: 
app.delete('/suppliers/:id', async (req, res) => {
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














// Khởi chạy server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});
