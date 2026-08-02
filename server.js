const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ⚠️ ĐIỀN THÔNG TIN SUPABASE BƯỚC 1 CỦA BẠN VÀO 2 DÒNG NÀY:
const SUPABASE_URL = 'https://prowunbttjdcqeqmprxr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb3d1bmJ0dGpkY3FlcW1wcnhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNzk0MDUsImV4cCI6MjEwMDk1NTQwNX0.8BaqqhAQZ92T4VlMyrI6baLa6nH2bIuiW9eOUGCbaj4';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// API 1: Raspberry Pi tải Video lên Supabase Storage
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const { qr_code, api_key } = req.body;
    const file = req.file;

    if (api_key !== 'dhn_secret_key_123456') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const cleanQr = qr_code ? qr_code.trim() : 'UNKNOWN';
    const fileName = `${cleanQr}_${Date.now()}.mp4`;

    const { error: uploadErr } = await supabase.storage
      .from('packaging-videos')
      .upload(fileName, file.buffer, {
        contentType: 'video/mp4',
        upsert: true
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage
      .from('packaging-videos')
      .getPublicUrl(fileName);

    return res.json({ success: true, url: urlData.publicUrl });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// API 2: LẤY DANH SÁCH TOÀN BỘ VIDEO ĐÃ UPLOAD LÊN WEB
app.get('/api/videos', async (req, res) => {
  try {
    // Sửa chuẩn Supabase Storage API: truyền 'folder path' rõ ràng là trống hoặc ' '
    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list('', { limit: 100, offset: 0, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) throw error;

    // Lọc bỏ file hệ thống (.emptyFolderPlaceholder...)
    const validFiles = (files || []).filter(f => f.name && !f.name.startsWith('.'));

    const videoList = validFiles.map(file => {
      const { data: urlData } = supabase.storage
        .from('packaging-videos')
        .getPublicUrl(file.name);

      // Tách lấy Mã QR từ tên file (Ví dụ: DHN-77475C10_17223123.mp4 -> DHN-77475C10)
      const qrCode = file.name.split('_')[0];

      return {
        name: file.name,
        qr_code: qrCode,
        video_url: urlData.publicUrl,
        created_at: file.created_at
      };
    });

    return res.json({ success: true, videos: videoList });
  } catch (err) {
    console.error('List Error:', err);
    return res.status(500).json({ error: err.message });
  }
});
// ==========================================
// API XOÁ VIDEO THEO ID
// ==========================================
app.delete('/api/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Tìm thông tin video trong DB để lấy tên file
    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !video) {
      return res.status(404).json({ error: 'Không tìm thấy video!' });
    }

    // Tách lấy tên file từ URL
    const fileName = video.video_url.split('/').pop();

    // 2. Xoá file video trên Supabase Storage
    const { error: storageError } = await supabase
      .storage
      .from('packaging-videos')
      .remove([fileName]);

    if (storageError) console.error('Lỗi xoá Storage:', storageError);

    // 3. Xoá dòng ghi nhận trong Supabase Database
    const { error: dbError } = await supabase
      .from('videos')
      .delete()
      .eq('id', id);

    if (dbError) return res.status(500).json({ error: 'Lỗi khi xoá Database!' });

    res.json({ success: true, message: 'Đã xoá video thành công!' });
  } catch (err) {
    console.error('Lỗi Server:', err);
    res.status(500).json({ error: 'Lỗi hệ thống!' });
  }
});
// API 3: TRA CỨU VIDEO THEO MÃ QR
app.get('/api/search/:qr_code', async (req, res) => {
  try {
    const qr = req.params.qr_code.trim();

    const { data: files, error } = await supabase.storage
      .from('packaging-videos')
      .list('', { limit: 200, offset: 0 });

    if (error) throw error;

    const matchedFiles = (files || []).filter(f => f.name && f.name.includes(qr));

    if (matchedFiles.length === 0) {
      return res.status(404).json({ error: `Không tìm thấy video nào cho mã đơn: ${qr}` });
    }

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
    console.error('Search Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
