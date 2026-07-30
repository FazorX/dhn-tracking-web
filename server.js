const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ⚠️ THAY THÔNG TIN SUPABASE CỦA BẠN VÀO 2 DÒNG NÀY:
const SUPABASE_URL = 'THAY_PROJECT_URL_CUA_BAN_VAO_DAY';
const SUPABASE_KEY = 'THAY_ANON_PUBLIC_KEY_CUA_BAN_VAO_DAY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// API 1: Tải video từ Pi lên
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { qr_code, created_at, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Đặt tên file dạng: MAQR_THOIGIAN.mp4
    const fileName = `${qr_code}_${Date.now()}.mp4`;

    const { data, error } = await supabase.storage
      .from('packaging-videos')
      .upload(fileName, file.buffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(fileName);

    return res.json({ success: true, url: urlData.publicUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// API 2: Tra cứu video theo Mã QR (Đã FIX LỖI PATH)
app.get('/api/search/:qr_code', async (req, res) => {
  try {
    const qr = req.params.qr_code.trim();

    // Lấy danh sách file trong bucket
    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list();

    if (error) throw error;

    // Lọc các file có chứa Mã QR người dùng nhập
    const matchedFiles = files.filter(f => f.name.includes(qr));

    if (!matchedFiles || matchedFiles.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy video đóng gói cho mã này!' });
    }

    // Sắp xếp lấy video mới nhất
    matchedFiles.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latestFile = matchedFiles[0];

    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(latestFile.name);

    return res.json({
      qr_code: qr,
      video_url: urlData.publicUrl,
      created_at: latestFile.created_at
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
