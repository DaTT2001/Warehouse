require('dotenv').config();
const express = require('express');
const { Client } = require('pg');

const app = express();
const port = 3000;
app.use(express.json());  // Middleware để Express có thể đọc body request dạng JSON


// Cấu hình kết nối với PostgreSQL
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
// Kết nối với PostgreSQL
client.connect()
  .then(() => console.log('Kết nối đến PostgreSQL thành công'))
  .catch((err) => console.error('Lỗi kết nối:', err));

// API GET để lấy dữ liệu từ bảng
app.get('/products', async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM Products');
    res.json(result.rows);
  } catch (err) {
    console.error('Lỗi khi truy vấn dữ liệu:', err);
    res.status(500).send('Lỗi server');
  }
});

//products
// API lấy tất cả sản phẩm
app.get('/products', async (req, res) => {
    try {
      const query = 'SELECT * FROM public.products';
      const result = await client.query(query);
      res.json(result.rows); // Trả về danh sách sản phẩm
    } catch (err) {
      console.error('Error fetching products:', err.stack);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  // API thêm sản phẩm mới
  app.post('/products', async (req, res) => {
    const { productid, productname, unit, price, quantity } = req.body;
  
    // Kiểm tra xem tất cả các trường có được cung cấp hay không
    if (!productid || !productname || !unit || price === undefined || quantity === undefined) {
      return res.status(400).json({ error: 'All fields (productid, productname, unit, price, quantity) are required' });
    }
  
    try {
      // Kiểm tra xem productid có bị trùng không
      const checkQuery = 'SELECT * FROM public.products WHERE productid = $1';
      const checkResult = await client.query(checkQuery, [productid]);
  
      if (checkResult.rows.length > 0) {
        return res.status(400).json({ error: 'Product ID already exists' });
      }
  
      // Cập nhật câu lệnh INSERT để thêm quantity
      const query = `
        INSERT INTO public.products (productid, productname, unit, price, quantity)
        VALUES ($1, $2, $3, $4, $5) RETURNING *;
      `;
      const values = [productid, productname, unit, price, quantity];
      const result = await client.query(query, values);
  
      res.status(201).json(result.rows[0]);  // Trả về sản phẩm đã được tạo
    } catch (err) {
      console.error('Error creating product:', err.stack);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  
  
  // API sửa thông tin sản phẩm
  app.put('/products/:id', async (req, res) => {
    const productid = req.params.id;
    const { productname, unit, price, quantity } = req.body;
  
    if (!productname || !unit || price === undefined || quantity === undefined) {
      return res.status(400).json({ error: 'All fields (productname, unit, price, quantity) are required' });
    }
  
    try {
      const query = `
        UPDATE public.products
        SET productname = $1, unit = $2, price = $3, quantity = $4
        WHERE productid = $5
        RETURNING *;
      `;
      const values = [productname, unit, price, quantity, productid];
      const result = await client.query(query, values);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
  
      res.status(200).json(result.rows[0]);  // Trả về sản phẩm đã được cập nhật
    } catch (err) {
      console.error('Error updating product:', err.stack);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  
  // API xóa sản phẩm
  app.delete('/products/:id', async (req, res) => {
    const productId = req.params.id;
  
    try {
      const query = 'DELETE FROM public.products WHERE productid = $1 RETURNING *;';
      const values = [productId];
      const result = await client.query(query, values);
  
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
  
      res.status(204).send(); // Trả về 204 No Content nếu xóa thành công
    } catch (err) {
      console.error('Error deleting product:', err.stack);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
// Khởi chạy server
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
  });
  