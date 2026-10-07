import "dotenv/config";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import pino from "pino";
import qrcode from "qrcode-terminal";
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

// ============================================================
// WHATSAPP CONNECTION
// ============================================================

async function connectWhatsApp() {
  console.log("Starting WhatsApp gateway...");

  // auth_info stores the linked-device session.
  // Do NOT upload this folder publicly.
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

      // --------------------------------------------------------
      // QR CODE
      // --------------------------------------------------------

      if (qr) {
        console.log(
          "\n================================="
        );

        console.log(
          "📱 SCAN THIS QR CODE"
        );

        console.log(
          "=================================\n"
        );

        qrcode.generate(
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

      // --------------------------------------------------------
      // CONNECTED
      // --------------------------------------------------------

      if (connection === "open") {
        whatsappConnected = true;

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

      // --------------------------------------------------------
      // DISCONNECTED
      // --------------------------------------------------------

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
          console.log(
            "❌ WhatsApp account was logged out."
          );

          console.log(
            "To connect again:"
          );

          console.log(
            "1. Stop the server"
          );

          console.log(
            "2. Delete the auth_info folder"
          );

          console.log(
            "3. Run node index.js"
          );

          console.log(
            "4. Scan the new QR code"
          );

          return;
        }

        // Avoid creating multiple reconnect timers
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
    });
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

    const authorization =
      req.headers.authorization;

    if (
      authorization !==
      `Bearer ${API_SECRET}`
    ) {
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
      // CHECK WHATSAPP CONNECTION
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

      // --------------------------------------------------------
      // RECIPIENT LIST
      // --------------------------------------------------------

      // Accept:
      //
      // "to": "+9665..."
      //
      // OR
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

      // --------------------------------------------------------
      // SEND RESULTS
      // --------------------------------------------------------

      const results = [];

      // --------------------------------------------------------
      // SEND TO EACH RECIPIENT
      // --------------------------------------------------------

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
        // -
        // brackets
        // etc.
        //
        // +966 50 123 4567
        //
        // becomes:
        //
        // 966501234567

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

        // ------------------------------------------------------
        // SMALL DELAY BETWEEN RECIPIENTS
        // ------------------------------------------------------

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

      // --------------------------------------------------------
      // SUMMARY
      // --------------------------------------------------------

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
      `API: http://localhost:${PORT}`
    );

    console.log(
      `Health: http://localhost:${PORT}/health`
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