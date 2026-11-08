# 🌩️ Project SkySentry
**Zero-Budget Tactical Weather Radar & Hyperlocal Storm Tracking Engine**

[![Version](https://img.shields.io/badge/version-v0.1.2_(DEV_BUILD)-0284c7?style=flat-square)](https://github.com/Worapon-PZ/Project-Skysentry)
[![Architecture](https://img.shields.io/badge/architecture-Client--Side_100%25-059669?style=flat-square)](https://github.com/Worapon-PZ/Project-Skysentry)
[![Deployment](https://img.shields.io/badge/deployment-GitHub_Pages-22c55e?style=flat-square)](https://worapon-pz.github.io/Project-Skysentry/)
[![License](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)

> 📡 **Live Dashboard:** [https://worapon-pz.github.io/Project-Skysentry/](https://worapon-pz.github.io/Project-Skysentry/)

---

## 🧭 About The Project
**Project SkySentry** คือแดชบอร์ดเรดาร์สภาพอากาศเชิงยุทธวิธีบนเว็บเบราว์เซอร์ ที่พัฒนาขึ้นภายใต้หลักปรัชญา **"งบประมาณ 0 บาท (Zero-Budget Architecture)"** โดยประมวลผลบนฝั่งผู้ใช้งาน (Client-Side) ทั้งหมด 100% โดยไม่ต้องพึ่งพาเซิร์ฟเวอร์หลังบ้านราคาแพง 

ระบบทำการผสานรวมข้อมูลเรดาร์สะท้อนคลื่นแบบเรียลไทม์เข้ากับการคำนวณเวกเตอร์ทางเรขาคณิต (Geodesic Vectoring) เพื่อตรวจจับ ติดตามความเร็ว ทิศทาง และคำนวณเวลาเข้าปะทะของกลุ่มพายุ (Dynamic ETA) พร้อมทั้งเก็บสถิติความแม่นยำภาคสนาม (Ground-Truth) บันทึกเข้าสู่ฐานข้อมูลคลาวด์โดยตรง

---

## ⚡ 7 Core Tactical Features

### 1. 🔄 Multi-Frame Radar Playback & 30-Min Nowcast
* ร้อยเรียงข้อมูลเรดาร์จาก RainViewer API ครอบคลุมทั้ง **ภาพย้อนหลัง ~2 ชั่วโมง (`PAST`)** และ **ภาพทำนายฝนล่วงหน้า 30 นาที (`NOWCAST`)**
* แถบสไลเดอร์ควบคุมไทม์ไลน์แบบ 2 แถว (Two-Tier Layout) ป้องกันตัวอักษรทับซ้อน พร้อมปุ่มปรับสปีด (0.5x, 1x, 2x) และปุ่มลัด **`🔴 สด (LIVE)`** ดีดกลับมายังเฟรมปัจจุบัน ($T_0$) ในคลิกเดียว

### 2. 🎯 Reverse dBZ & Precipitation Intensity Analysis
* วิศวกรรมย้อนกลับค่าสีเรดาร์ผ่าน Offscreen HTML5 Canvas ด้วยสมการระยะห่างแบบยุคลิด (Euclidean Color Distance) เทียบกับ Universal dBZ Palette
* แปลงค่าความเข้มสะท้อนคลื่น ($dBZ$) เป็นอัตราการตกของฝน ($R$ หน่วย $mm/h$) แบบเรียลไทม์ ผ่านสมการ Marshall-Palmer:
  $$Z = 200 \cdot R^{1.6} \implies R = \left(\frac{10^{\frac{dBZ}{10}}}{200}\right)^{\frac{1}{1.6}}$$

### 3. 🌪️ Tactical Storm Tracking & Dynamic ETA Engine
* กวาดอ่านพิกเซลผ่าน Grid Sampling ความละเอียด 10px เพื่อลดภาระการประมวลผลของเบราว์เซอร์
* **Dual-Threshold Filter:** แยกแยะกลุ่มฝนเฝ้าระวัง ($\ge 20\text{ dBZ}$) และแกนกลางพายุรุนแรง ($\ge 35\text{ dBZ}$)
* **Direct-Hit Bypass:** หากมีฝนตกคลุมพิกัดเป้าหมายในระยะ 1.5 กม. ระบบจะข้ามสมการคำนวณและรายงานสถานะ *"🌧️ ฝนกำลังตกในพื้นที่เป้าหมาย"* ทันที เพื่อป้องกันข้อผิดพลาด Divide-by-Zero
* **Geodesic Vectoring:** สกัด Centroid ของกลุ่มพายุที่ใกล้ที่สุดในรัศมี 40 กม. คำนวณความเร็ว ($km/h$) มุมทิศทางเดินพายุ (Azimuth Bearing) ลากเส้นคาดการณ์ล่วงหน้า 60 นาที (`L.polyline`) และประเมินเวลาเข้าปะทะพิกัดเป้าหมาย (ETA)

### 4. 🌦️ Weather Telemetry & Hourly Forecast
* เชื่อมต่อข้อมูลสภาพอากาศสดและพยากรณ์ล่วงหน้ารายชั่วโมงจาก Open-Meteo API อิงตามพิกัดเป้าหมาย
* แผง Tactical Drawer ฝั่งขวาสไตล์ Windy แสดงอุณหภูมิ, ความชื้นสัมพัทธ์, โอกาสเกิดฝน, ความเร็วลม และแถบพยากรณ์ล่วงหน้า 12 ชั่วโมง พร้อมปุ่มพับเก็บแบบมินิมอล (`❯`) และโมดัลพยากรณ์ 7 วัน (7-Day Outlook)

### 5. 📍 Target Anchor & Home Persistence
* สามารถคลิกเลือกพิกัดเฝ้าระวังบนแผนที่ได้อย่างอิสระ (`📍 เลือกพิกัดเอง`)
* รองรับการบันทึกพิกัดบ้านลงหน่วยความจำเบราว์เซอร์ (`Web Storage API: localStorage`) 
* พิกัดศูนย์กลางเริ่มต้น: **อำเภอบางกรวย จังหวัดนนทบุรี** (`13.8050° N, 100.4728° E`) พร้อมวงแหวนตรวจการณ์ยุทธวิธี 5 กม., 10 กม. และ 20 กม. (No-lag LayerGroup)

### 6. 📝 Ground-Truth Precision Engine (2-Step Verification)
* ระบบเก็บบันทึกผลการพยากรณ์เทียบกับเหตุการณ์ฝนตกจริงภาคสนาม สำหรับนำไปวิเคราะห์ค่าความแม่นยำ (Validation Matrix)
* กลไกป้องกันการกดย้ำ (Anti-Spam): ระบบยืนยัน 2 ขั้นตอน พร้อมแอนิเมชันนับถอยหลังล็อกปุ่ม 3 วินาทีก่อนส่งข้อมูล Asynchronous POST ไปยัง Google Sheets ผ่าน Google Apps Script Webhook

### 7. 🚨 Tactical Alert HUD & Synthesized Audio Warning
* ป้ายสถานะลอย (Floating Status Pill) กึ่งกลางขอบบน แสดงระดับการเตือนภัย 4 ขั้น:
  * 🟢 **NORMAL:** สภาพอากาศปกติ (ไม่พบกลุ่มฝนคุกคามในรัศมี 40 กม.)
  * 🟡 **WATCH:** เฝ้าระวังกลุ่มฝนกำลังเคลื่อนตัวเข้าหา
  * 🔴 **WARNING:** เตือนภัยกลุ่มฝนรุนแรงเตรียมเข้าปะทะในระยะกระชั้นชิด
  * 🌧️ **RAINING NOW:** มีกลุ่มฝนตกในพื้นที่เป้าหมายขณะนี้
* ระบบเสียงสังเคราะห์ผ่าน Web Audio API (`AudioContext`) ส่งสัญญาณเตือนภัยโดยไม่ต้องพึ่งพาไฟล์เสียงภายนอก

---

## 🛠️ Tech Stack & Architecture

| Layer | Technologies / Services |
| :--- | :--- |
| **Core Frontend** | HTML5, CSS3 (Modern Flex/Grid), JavaScript (ES6+ Vanilla) |
| **Mapping Engine** | [Leaflet.js](https://leafletjs.com/) (v1.9.4) & OpenStreetMap Tile Layer |
| **Radar Ingestion** | [RainViewer API](https://www.rainviewer.com/api.html) (Composite Radar & 30-min Nowcast) |
| **Weather Telemetry** | [Open-Meteo API](https://open-meteo.com/) (Free Tier, Hyperlocal Models) |
| **Data Logging** | Google Apps Script & Google Sheets Database |
| **Hosting & CI/CD** | GitHub Pages (Automated Deployment from `main` branch) |

---

## 📁 Repository Structure

```text
Project-Skysentry/
├── index.html              # โครงสร้างหน้าจอและเลย์เอาต์ Light Tactical Glassmorphism
├── style.css               # ระบบธีมกระจกฝ้าสีสว่าง จัดระเบียบ Z-Index และ Responsive UI
├── script.js               # เอนจินคำนวณเวกเตอร์, RainViewer/Open-Meteo Ingestion, Web Audio
├── README.md               # เอกสารประกอบโปรเจกต์และคู่มือการใช้งาน
└── assets/                 # ไอคอนและทรัพยากรภาพประกอบ
