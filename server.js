const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ⚠️ ĐIỀN THÔNG TIN SUPABASE CỦA BẠN VÀO 2 DÒNG NÀY:
const SUPABASE_URL = 'https://prowunbttjdcqeqmprxr.supabase.co/rest/v1/';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb3d1bmJ0dGpkY3FlcW1wcnhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNzk0MDUsImV4cCI6MjEwMDk1NTQwNX0.8BaqqhAQZ92T4VlMyrI6baLa6nH2bIuiW9eOUGCbaj4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// API 1: Raspberry Pi tải Video lên + Lưu vào Database
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { qr_code, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const cleanQr = qr_code.trim();
    const fileName = `${cleanQr}_${Date.now()}.mp4`;

    // 1. Upload file mp4 lên Storage
    const { error: uploadErr } = await supabase.storage
      .from('packaging-videos')
      .upload(fileName, file.buffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    // 2. Lấy link public video
    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(fileName);

    const videoUrl = urlData.publicUrl;

    // 3. Lưu thông tin vào Database
    const { error: dbErr } = await supabase
      .from('videos')
      .insert([{ qr_code: cleanQr, video_url: videoUrl }]);

    if (dbErr) console.error('Database log error:', dbErr);

    return res.json({ success: true, url: videoUrl });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// API 2: Tra cứu Video theo Mã QR từ Database (ĐÃ TỐI ƯU CỰC MƯỢT)
app.get('/api/search/:qr_code', async (req, res) => {
  try {
    const qr = req.params.qr_code.trim();

    // Tìm trong Database bảng videos
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .ilike('qr_code', `%${qr}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: `Không tìm thấy video nào cho mã đơn: ${qr}` });
    }

    const latestVideo = data[0];

    return res.json({
      qr_code: latestVideo.qr_code,
      video_url: latestVideo.video_url,
      created_at: latestVideo.created_at
    });
  } catch (err) {
    console.error('Search Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
