const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");

const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const mongoose = require('mongoose');
require('dotenv').config();

const Task = require("./models/task"); // ✅ Correct path


const upload = multer({ dest: "uploads/" }); // temporary storage

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("✅ Connected to MongoDB Atlas");
}).catch((err) => {
  console.error("❌ MongoDB connection error:", err);
});

app.use(cors({
  origin: 'https://login-check-app.web.app',
  credentials: true
}));

app.options('*', cors({
  origin: 'https://login-check-app.web.app',  // your Firebase frontend URL
  credentials: true
}));
app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFirebaseToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) return res.status(401).send("No token provided");

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).send("Invalid token");
  }
};


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

app.post("/add-task", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!idToken) {
      return res.status(401).json({ error: "Missing ID token" });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const { name, date, imageUrl } = req.body;

    if (!name || !date) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const task = new Task({
      name,
      date,
      imageUrl: imageUrl || "",
      userId,
    });

    await task.save();
    res.status(201).json({ message: "Task saved successfully" });
  } catch (error) {
    console.error("Add Task Error:", error.message);
    res.status(500).json({ error: "Failed to save task" });
  }
});

app.get("/get-tasks", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!idToken) {
      return res.status(401).json({ error: "Missing ID token" });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userId = decodedToken.uid;

    const tasks = await Task.find({ userId });

    res.status(200).json({ tasks });
  } catch (error) {
    console.error("Get Tasks Error:", error.message);
    res.status(500).json({ error: "Failed to load tasks" });
  }
});



app.post("/upload", verifyFirebaseToken, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    // Step 1: Authorize with Backblaze
    const authRes = await axios.get("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      auth: {
        username: process.env.B2_KEY_ID,
        password: process.env.B2_APP_KEY,
      },
    });

    const { authorizationToken, apiUrl, downloadUrl, allowed, accountId } = authRes.data;

    // Step 2: Get upload URL
    const bucketId = "2a3e8b5b5d36e9679277041b";
    const uploadUrlRes = await axios.post(
      `${apiUrl}/b2api/v2/b2_get_upload_url`,
      { bucketId },
      { headers: { Authorization: authorizationToken } }
    );

    const { uploadUrl, authorizationToken: uploadAuthToken } = uploadUrlRes.data;

    // Step 3: Upload file
    const fileBuffer = fs.readFileSync(file.path);
    const fileName = file.originalname;

    const uploadHeaders = {
      Authorization: uploadAuthToken,
      "X-Bz-File-Name": encodeURIComponent(fileName),
      "Content-Type": "b2/x-auto",
      "Content-Length": fileBuffer.length,
      "X-Bz-Content-Sha1": "do_not_verify",
    };

    await axios.post(uploadUrl, fileBuffer, {
      headers: uploadHeaders,
    });

    fs.unlinkSync(file.path); // remove local file

    const publicUrl = `https://f000.backblazeb2.com/file/To-do-Images/${encodeURIComponent(fileName)}`;

    res.json({ 
      message: "File uploaded to Backblaze successfully",
      imageUrl: publicUrl
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Upload failed" });
  }
});


app.listen(3000, () => console.log("Server started on port 3000"));
