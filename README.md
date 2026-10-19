# 🌩️ Project SkySentry
**Zero-Budget Tactical Weather Radar & Storm Tracking Engine**

![Version](https://img.shields.io/badge/version-v0.1.1-blue)
![Architecture](https://img.shields.io/badge/architecture-Client--side-green)
![Status](https://img.shields.io/badge/status-Active_Development-orange)

## 🎯 About The Project
**Project SkySentry** is a high-performance, web-based tactical weather radar dashboard built with a strict "Zero-Budget" philosophy. It leverages client-side processing to reverse-engineer radar data, track storm cells, calculate ETA, and collect ground-truth accuracy metrics without relying on costly backend servers.

### 🌟 Key Features
- **Real-Time Radar Ingestion:** Integrates RainViewer API data dynamically.
- **Reverse dBZ Engineering:** Extracts rainfall intensity ($mm/h$) using the Marshall-Palmer relation via pixel color sampling.
- **Tactical Storm Tracking:** Calculates storm vector, speed, and Estimated Time of Arrival (ETA) to a designated Home Pin.
- **Ground-Truth Precision Engine:** Features a 3-step verification reporting system to log actual rainfall events directly to a Google Sheets database for accuracy analysis.
- **Windy-Style UI:** A clean, collapsible, and responsive Glassmorphism interface optimized for both desktop and mobile operations.

## 🛠️ Built With
* [HTML5 / CSS3 / JavaScript (ES6+)]
* [Leaflet.js](https://leafletjs.com/) - Core mapping engine
* [RainViewer API](https://www.rainviewer.com/api.html) - Weather radar tiles
* [Open-Meteo API](https://open-meteo.com/) - Hourly forecast data
* Google Apps Script & Sheets - Ground-truth data logging

## 🚀 Getting Started
Since the project runs entirely on the client side, no server installation is required.
1. Clone the repo:
   ```sh
   git clone [https://github.com/Worapon-PZ/Project-Skysentry.git](https://github.com/Worapon-PZ/Project-Skysentry.git)
