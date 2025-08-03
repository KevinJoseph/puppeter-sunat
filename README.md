# Sunat API

This project is an Express API that allows users to interact with the SUNAT website using Puppeteer for web scraping tasks. The API accepts RUC, username, and password, and executes a Puppeteer script to perform the necessary actions.

## Project Structure

```
sunat-api
├── src
│   ├── app.js               # Entry point of the application
│   ├── routes
│   │   └── sunat.routes.js  # API routes definition
│   ├── controllers
│   │   └── sunat.controller.js # Controller for handling requests
│   ├── services
│   │   └── sunat.service.js  # Service for executing the Puppeteer script
│   └── scripts
│       └── sunat.script.js   # Puppeteer script for web scraping
├── package.json              # NPM configuration file
└── README.md                 # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd sunat-api
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the API:**
   ```bash
   npm start
   ```

## Usage

To use the API, send a POST request to the `/api/sunat` endpoint with the following JSON body:

```json
{
  "ruc": "XXXXXX",
  "username": "XXXXXX",
  "password": "XXXXXX"
}
```

## License

This project is licensed under the MIT License.