import nodemailer from 'nodemailer';
import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';

export async function sendDigest({ html, text, date, dryRun = false }) {
  if (dryRun) {
    const path = '.dry-run-output.html';
    await writeFile(path, html, 'utf8');
    console.log(`💾 Dry-run: saved to ${path}`);
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execFile(opener, [path]);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `📈 Daily Stock Digest — ${date}`,
      text,
      html,
    });
    console.log(`✅ Digest sent to ${process.env.EMAIL_TO}`);
  } catch (err) {
    console.error(`❌ Email delivery failed: ${err.message}`);
    console.error(`SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} user=${process.env.SMTP_USER}`);
    process.exit(1);
  }
}
