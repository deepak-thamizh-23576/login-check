const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

app.use(cors({
  origin: 'https://login-check-app.web.app',  // your Firebase frontend URL
  credentials: true
}));
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.get('/', (req, res) => {
  res.send('Backend is running!');
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

app.post("/logout", (req, res) => {
  res.clearCookie("connect.sid");
  req.session.destroy(() => {
    res.status(200).send("Logged out");
  });
});


app.listen(3000, () => console.log("Server started on port 3000"));
