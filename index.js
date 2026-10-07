import "dotenv/config";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import express from "express";

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET;

if (!API_SECRET) {
  throw new Error(
    "Missing API_SECRET environment variable"
  );
}

// ============================================================
// GLOBAL STATE
// ============================================================

let sock = null;
let whatsappConnected = false;
let reconnectTimer = null;

// Stores the latest QR temporarily in memory.
// Once WhatsApp connects, this is cleared.
let latestQR = null;

// ============================================================
// WHATSAPP CONNECTION
// ============================================================

async function connectWhatsApp() {
  console.log("Starting WhatsApp gateway...");

  // Locally:
  // ./auth_info
  //
  // Railway:
  // mount persistent volume at /app/auth_info
  //
  // This keeps the WhatsApp linked-device session.
  const { state, saveCreds } =
    await useMultiFileAuthState("./auth_info");

  sock = makeWASocket({
    auth: state,

    logger: pino({
      level: "silent",
    }),

    printQRInTerminal: false,
  });

  // Save WhatsApp credentials whenever they change
  sock.ev.on(
    "creds.update",
    saveCreds
  );

  // ==========================================================
  // CONNECTION EVENTS
  // ==========================================================

  sock.ev.on(
    "connection.update",
    async (update) => {
      const {
        connection,
        lastDisconnect,
        qr,
      } = update;

      // ========================================================
      // QR CODE GENERATED
      // ========================================================

      if (qr) {
        // Save QR so the /qr endpoint can display it
        latestQR = qr;

        console.log(
          "\n================================="
        );

        console.log(
          "📱 WHATSAPP QR GENERATED"
        );

        console.log(
          "=================================\n"
        );

        // Still display QR locally in the terminal.
        // Useful when running node index.js on your computer.
        qrcodeTerminal.generate(
          qr,
          {
            small: true,
          }
        );

        console.log(
          "\nOn your phone:"
        );

        console.log(
          "WhatsApp → Settings → Linked Devices → Link a Device"
        );

        console.log();
      }

      // ========================================================
      // CONNECTED
      // ========================================================

      if (connection === "open") {
        whatsappConnected = true;

        // QR is no longer needed
        latestQR = null;

        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        console.log(
          "================================="
        );

        console.log(
          "✅ WHATSAPP CONNECTED"
        );

        console.log(
          "================================="
        );

        console.log(
          "Connected account:",
          sock?.user?.id ?? "Unknown"
        );
      }

      // ========================================================
      // DISCONNECTED
      // ========================================================

      if (connection === "close") {
        whatsappConnected = false;

        const statusCode =
          lastDisconnect
            ?.error
            ?.output
            ?.statusCode;

        console.log(
          "WhatsApp connection closed."
        );

        console.log(
          "Status code:",
          statusCode
        );

        const loggedOut =
          statusCode ===
          DisconnectReason.loggedOut;

        if (loggedOut) {
          latestQR = null;

          console.log(
            "❌ WhatsApp account was logged out."
          );

          console.log(
            "The account must be paired again."
          );

          console.log(
            "If necessary, clear auth_info and restart the gateway."
          );

          return;
        }

        // Prevent multiple reconnect timers
        if (!reconnectTimer) {
          console.log(
            "Trying to reconnect in 3 seconds..."
          );

          reconnectTimer =
            setTimeout(() => {
              reconnectTimer = null;

              connectWhatsApp()
                .catch((error) => {
                  console.error(
                    "Reconnect failed:",
                    error
                  );
                });

            }, 3000);
        }
      }
    }
  );
}

// ============================================================
// EXPRESS SERVER
// ============================================================

const app = express();

app.use(
  express.json({
    limit: "1mb",
  })
);

// ============================================================
// AUTHENTICATION HELPER
// ============================================================

function isAuthorized(req) {
  const authorization =
    req.headers.authorization;

  return (
    authorization ===
    `Bearer ${API_SECRET}`
  );
}

// ============================================================
// HOME
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.json({
      service:
        "WhatsApp Gateway",

      status:
        "running",

      whatsapp_connected:
        whatsappConnected,
    });
  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/health",
  (req, res) => {
    res.json({
      success: true,

      service:
        "WhatsApp Gateway",

      whatsapp_connected:
        whatsappConnected,

      whatsapp_account:
        whatsappConnected
          ? sock?.user?.id ?? null
          : null,

      qr_available:
        Boolean(latestQR),
    });
  }
);

// ============================================================
// QR CODE
// ============================================================
//
// Protected endpoint.
//
// IMPORTANT:
// Do NOT put API_SECRET in the URL.
//
// Request:
// GET /qr
//
// Header:
// Authorization: Bearer YOUR_API_SECRET
//
// ============================================================

app.get(
  "/qr",
  async (req, res) => {

    // ----------------------------------------------------------
    // AUTHENTICATION
    // ----------------------------------------------------------

    if (!isAuthorized(req)) {
      console.log(
        "❌ Unauthorized /qr request"
      );

      return res
        .status(401)
        .send("Unauthorized");
    }

    // ----------------------------------------------------------
    // ALREADY CONNECTED
    // ----------------------------------------------------------

    if (whatsappConnected) {
      return res.send(`
        <!DOCTYPE html>

        <html>
          <head>
            <title>WhatsApp Gateway</title>

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            >
          </head>

          <body
            style="
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
            "
          >

            <h1>
              ✅ WhatsApp Connected
            </h1>

            <p>
              The gateway is already linked
              to WhatsApp.
            </p>

          </body>
        </html>
      `);
    }

    // ----------------------------------------------------------
    // WAITING FOR QR
    // ----------------------------------------------------------

    if (!latestQR) {
      return res.send(`
        <!DOCTYPE html>

        <html>
          <head>
            <title>WhatsApp Gateway</title>

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            >

            <meta
              http-equiv="refresh"
              content="5"
            >
          </head>

          <body
            style="
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 50px;
            "
          >

            <h2>
              Waiting for WhatsApp QR...
            </h2>

            <p>
              The page will refresh automatically.
            </p>

          </body>
        </html>
      `);
    }

    // ----------------------------------------------------------
    // GENERATE QR IMAGE
    // ----------------------------------------------------------

    try {
      const qrImage =
        await QRCode.toDataURL(
          latestQR,
          {
            width: 400,
            margin: 2,
          }
        );

      return res.send(`
        <!DOCTYPE html>

        <html>
          <head>

            <title>
              WhatsApp Gateway Pairing
            </title>

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1"
            >

          </head>

          <body
            style="
              font-family: Arial, sans-serif;
              text-align: center;
              padding: 30px;
            "
          >

            <h1>
              WhatsApp Gateway
            </h1>

            <h2>
              📱 Pair WhatsApp
            </h2>

            <p>
              On your phone open:
            </p>

            <p>
              <strong>
                WhatsApp →
                Settings →
                Linked Devices →
                Link a Device
              </strong>
            </p>

            <img
              src="${qrImage}"
              width="400"
              height="400"
              alt="WhatsApp QR Code"
              style="
                max-width: 90%;
                height: auto;
              "
            >

            <p>
              If the QR expires,
              request /qr again.
            </p>

          </body>
        </html>
      `);

    } catch (error) {
      console.error(
        "QR generation error:",
        error
      );

      return res
        .status(500)
        .send(
          "Failed to generate QR code"
        );
    }
  }
);

// ============================================================
// SEND WHATSAPP MESSAGE
// ============================================================

app.post(
  "/send",
  async (req, res) => {

    // ----------------------------------------------------------
    // AUTHENTICATION
    // ----------------------------------------------------------

    if (!isAuthorized(req)) {
      console.log(
        "❌ Unauthorized /send request"
      );

      return res
        .status(401)
        .json({
          success: false,
          error: "Unauthorized",
        });
    }

    try {

      // --------------------------------------------------------
      // CHECK CONNECTION
      // --------------------------------------------------------

      if (
        !sock ||
        !whatsappConnected
      ) {
        return res
          .status(503)
          .json({
            success: false,

            error:
              "WhatsApp is not connected",
          });
      }

      // --------------------------------------------------------
      // REQUEST BODY
      // --------------------------------------------------------

      const {
        to,
        message,
      } = req.body;

      if (!to) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Missing recipient(s)",
          });
      }

      if (
        !message ||
        !String(message).trim()
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Missing message",
          });
      }

      // ========================================================
      // RECIPIENTS
      // ========================================================

      // Supports:
      //
      // "to": "+9665..."
      //
      // OR:
      //
      // "to": [
      //   "+9665...",
      //   "+9665...",
      //   "+9665..."
      // ]

      const recipients =
        Array.isArray(to)
          ? to
          : [to];

      if (
        recipients.length === 0
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Recipient list is empty",
          });
      }

      console.log(
        `Sending WhatsApp message to ${recipients.length} recipient(s)`
      );

      const results = [];

      // ========================================================
      // SEND ONE BY ONE
      // ========================================================

      for (
        let i = 0;
        i < recipients.length;
        i++
      ) {
        const recipient =
          recipients[i];

        // Remove:
        // +
        // spaces
        // dashes
        // brackets
        // etc.

        const cleanNumber =
          String(recipient)
            .replace(/\D/g, "");

        if (!cleanNumber) {
          results.push({
            recipient:
              "invalid",

            success:
              false,

            error:
              "Invalid phone number",
          });

          continue;
        }

        const maskedNumber =
          `***${cleanNumber.slice(-4)}`;

        const jid =
          `${cleanNumber}@s.whatsapp.net`;

        try {
          console.log(
            `Sending to ${maskedNumber}...`
          );

          const result =
            await sock.sendMessage(
              jid,
              {
                text:
                  String(message),
              }
            );

          console.log(
            `✅ Sent to ${maskedNumber}`
          );

          results.push({
            recipient:
              maskedNumber,

            success:
              true,

            message_id:
              result
                ?.key
                ?.id ?? null,
          });

        } catch (error) {
          console.error(
            `❌ Failed for ${maskedNumber}:`,
            error
          );

          results.push({
            recipient:
              maskedNumber,

            success:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        }

        // ======================================================
        // DELAY BETWEEN RECIPIENTS
        // ======================================================

        if (
          i <
          recipients.length - 1
        ) {
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                2000
              )
          );
        }
      }

      // ========================================================
      // RESULT SUMMARY
      // ========================================================

      const sent =
        results.filter(
          (result) =>
            result.success
        ).length;

      const failed =
        results.length -
        sent;

      console.log(
        `Finished. Sent: ${sent}, Failed: ${failed}`
      );

      return res.json({
        success:
          sent > 0,

        total:
          results.length,

        sent,

        failed,

        results,
      });

    } catch (error) {
      console.error(
        "Send endpoint error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
    }
  }
);

// ============================================================
// START EXPRESS SERVER
// ============================================================

app.listen(
  PORT,
  () => {
    console.log(
      "================================="
    );

    console.log(
      "🚀 WHATSAPP GATEWAY STARTED"
    );

    console.log(
      "================================="
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Local health check: http://localhost:${PORT}/health`
    );

    console.log();
  }
);

// ============================================================
// START WHATSAPP
// ============================================================

connectWhatsApp()
  .catch((error) => {
    console.error(
      "Initial WhatsApp connection failed:",
      error
    );
  });