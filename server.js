require('dotenv').config();
const express = require('express');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const resend = new Resend(process.env.RESEND_SIGNOFF_API_KEY);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/send-photos', async (req, res) => {
  const { storeId, city, state, address, energySet, resetDate, phase, coolerPhotos } = req.body;

  if (!coolerPhotos || !coolerPhotos.length) {
    return res.status(400).json({ error: 'No photos provided.' });
  }

  const phaseLabel = phase === 'after' ? 'After' : 'Before';

  const attachments = coolerPhotos.map(p => ({
    filename: p.fileName,
    content: Buffer.from(p.base64, 'base64')
  }));

  const photoList = coolerPhotos.map(p => `<li style="margin:4px 0">${p.fileName} — ${p.name}</li>`).join('');
  const fromAddress = `FM${storeId} <FM${storeId}@the-dump-bin.com>`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: 'april.gauthier@retailodyssey.com',
      cc: 'tyson.gauthier@retailodyssey.com',
      subject: `FM ${storeId} ${phaseLabel} Photos — ${city}, ${state}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="margin:0 0 8px">FM ${storeId} — ${phaseLabel} Photos</h2>
          <p style="color:#666;margin:0 0 4px">${city}, ${state} — ${address}</p>
          <p style="color:#666;margin:0 0 16px">${energySet} energy set · Reset: ${resetDate}</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>${coolerPhotos.length} ${phaseLabel.toLowerCase()} photos attached:</strong></p>
          <ul style="padding-left:20px;margin:0 0 16px">${photoList}</ul>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="color:#999;font-size:12px;margin:0">Sent from D6 Fuel Cooler Reset Guide</p>
        </div>
      `,
      attachments
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(400).json({ error: error.message || 'Email send failed.' });
    }

    console.log(`Email sent for FM ${storeId} from ${fromAddress} — ID: ${data.id}`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`D6 Fuel server running on port ${PORT}`);
});
