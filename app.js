const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

app.use(cors());
app.use(express.json());

const serviceAccount = require("./login-backend/login-check-4a8b8-firebase-adminsdk-fbsvc-30aa260fcc.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.post("/session-login", async (req, res) => {
  const idToken = req.body.idToken;

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("User ID:", decoded.uid);
    res.status(200).send("Backend accessed!");
  } catch (err) {
    res.status(401).send("Unauthorized");
  }
});

app.listen(3000, () => console.log("Server started on port 3000"));
