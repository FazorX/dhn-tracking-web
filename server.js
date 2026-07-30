const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ⚠️ THAY 2 THÔNG TIN SUPABASE BƯỚC 1 CỦA BẠN VÀO ĐÂY:
const SUPABASE_URL = 'THAY_PROJECT_URL_CUA_BAN_VAO_DAY';
const SUPABASE_KEY = 'THAY_ANON_PUBLIC_KEY_CUA_BAN_VAO_DAY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// API 1: Tải video từ Raspberry Pi lên Supabase
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { qr_code, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Đặt tên file chuẩn: MAQR_TIMESTAMP.mp4
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

// API 2: Tra cứu video theo Mã QR (FIX LỖI INVALID PATH)
app.get('/api/search/:qr_code', async (req, res) => {
  try {
    const qr = req.params.qr_code.trim();

    // Fix chuẩn Supabase SDK v2: Gọi list() không truyền tham số rỗng
    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list();

    if (error) throw error;

    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'Chưa có video nào trên hệ thống Cloud!' });
    }

    // Lọc các file có tên chứa mã QR vừa tìm
    const matchedFiles = files.filter(f => f.name.includes(qr));

    if (matchedFiles.length === 0) {
      return res.status(404).json({ error: `Không tìm thấy video nào cho mã đơn: ${qr}` });
    }

    // Lấy file mới nhất
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
