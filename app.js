const express = require("express");
const app = express();
const admin = require("firebase-admin");
const cors = require("cors");
const { collection } = require("./models/task");
const { Task } = require("./models/task");

const cloudinary = require('./cloudinary.config');
const querystring = require("querystring");

const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // temporary storage

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const mongoose = require('mongoose');
const session = require("express-session");

const MongoStore = require("connect-mongo");

app.use(
  session({
    secret: "loginCheck",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      ttl: 14 * 24 * 60 * 60, // Optional: 14 days
    }),
    cookie: {
      secure: true,
      sameSite: "none",
    },
  })
);

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
  const refreshToken = req.body.refreshToken || null;

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decoded.uid;
    const email = decoded.email || "";
    const provider = decoded.firebase?.sign_in_provider || "";

    console.log("User ID:", firebaseUid);

    // Find or create user in MongoDB
    let user = await collection.findOne({ firebaseUid });
    if (!user) {
      user = await collection.create({ 
        firebaseUid,
        email,
        signInProvider: provider,
        zohoRefreshToken: refreshToken,
      });
    } else {
      // Update email/refresh token if changed
      user.email = email;
      if (refreshToken) user.zohoRefreshToken = refreshToken;
      await user.save();
    }

    req.session.userId = user._id;

    req.session.email = email;
    await req.session.save();

    // OPTIONAL: Pre-fetch Zoho tasks for Zoho users (don't block response)
    // if (email.endsWith("@zohocorp.com") && user.zohoRefreshToken) {
    //   fetchZohoTasksForUser(user._id).catch(err =>
    //     console.error("Zoho fetch error:", err.message)
    //   );
    // }

    res.status(200).send("Session established!");
  } catch (err) {
    console.error("Session login error:", err.message);
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

    if (!name) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const task = new Task({
      name,
      date,
      imageUrl: imageUrl || "",
      userId,
      status: "pending"
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

    const tasks = await Task.find({ userId, status: "pending" });

    res.status(200).json({ tasks });
  } catch (error) {
    console.error("Get Tasks Error:", error.message);
    res.status(500).json({ error: "Failed to load tasks" });
  }
});

app.post("/upload", verifyFirebaseToken, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    // Step 1: Upload to Cloudinary first
    const cloudinaryResult = await cloudinary.uploader.upload(file.path, {
      folder: "todo_images",
    });

    const cloudinaryUrl = cloudinaryResult.secure_url;

    // Step 2: Upload to Backblaze
    const authRes = await axios.get("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      auth: {
        username: process.env.B2_KEY_ID,
        password: process.env.B2_APP_KEY,
      },
    });

    const { authorizationToken, apiUrl } = authRes.data;
    const bucketId = "2a3e8b5b5d36e9679277041b";

    const uploadUrlRes = await axios.post(
      `${apiUrl}/b2api/v2/b2_get_upload_url`,
      { bucketId },
      { headers: { Authorization: authorizationToken } }
    );

    const { uploadUrl, authorizationToken: uploadAuthToken } = uploadUrlRes.data;

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

    fs.unlinkSync(file.path); // Remove file after both uploads

    // Return only the Cloudinary URL to frontend
    res.json({
      message: "Uploaded to Cloudinary and Backblaze",
      imageUrl: cloudinaryUrl,
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.post("/update-task-status", verifyFirebaseToken, async (req, res) => {
  const { taskId, status } = req.body;
  const userId = req.user.uid;

  try {
    const updated = await Task.updateOne(
      { _id: taskId, userId },
      { $set: { status } }
    );

    if (updated.modifiedCount === 0) {
      return res.status(404).json({ error: "Task not found or not updated" });
    }

    res.json({ message: "Status updated" });
  } catch (err) {
    console.error("Update task status error:", err); // ⬅️ log full error
    res.status(500).json({ error: "Update failed", details: err.message });
  }
});

app.get("/get-completed-tasks", verifyFirebaseToken, async (req, res) => {
  const userId = req.user.uid;

  try {
    const tasks = await Task.find({ userId, status: "completed" });
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: "Failed to load completed tasks" });
  }
});


//------------------------Zoho CRM tasks integration------------------------
// Endpoint to check if Zoho is connected
app.get("/zoho-status", verifyFirebaseToken, async (req, res) => {
  const user = await collection.findOne({ firebaseUid: req.user.uid });
  res.json({ connected: !!(user && user.zohoRefreshToken) });
});

// Step 1: Start Zoho OAuth (redirect user to Zoho)
app.get("/zoho-auth-start", (req, res) => {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  const scope = "ZohoCRM.modules.ALL";
  const idToken = req.query.idToken;

  if (!idToken) return res.status(400).send("Missing idToken");
  // Optionally verify the token here if you want
  const url = `https://accounts.zoho.com/oauth/v2/auth?scope=${scope}&client_id=${clientId}&response_type=code&access_type=offline&redirect_uri=${encodeURIComponent(redirectUri)}&state=${idToken}`;
  res.redirect(url);
});

// Step 2: Zoho redirects back here with code
app.get("/zoho-oauth-callback", async (req, res) => {
  const code = req.query.code;
  const idToken = req.query.state;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  
  try {
    // Exchange code for tokens
    const tokenResp = await axios.post(
      "https://accounts.zoho.com/oauth/v2/token",
      querystring.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const refreshToken = tokenResp.data.refresh_token;

    // Use the idToken to find the user
    const decoded = await admin.auth().verifyIdToken(idToken);
    const firebaseUid = decoded.uid;

    // Save refresh token to user
    const user = await collection.findOne({ firebaseUid });
    if (user && refreshToken) {
      user.zohoRefreshToken = refreshToken;
      await user.save();
    }
    // Redirect to home page
    res.redirect("https://login-check-app.web.app/home.html");
  } catch (err) {
    res.status(500).send("Zoho OAuth failed: " + err.message);
  }
});


// Helper to get Zoho access token from refresh token
async function getZohoAccessToken(refreshToken) {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
  try {
      const resp = await axios.post(
        `https://accounts.zoho.${process.env.ZOHO_API_REGION || 'com'}/oauth/v2/token`,
        params,
        { 
          headers: { 
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      );
      
      if (!resp.data.access_token) {
        console.error('Zoho response:', resp.data);
        throw new Error('No access token received from Zoho');
      }
      
      return resp.data.access_token;
    } catch (error) {
      console.error('Zoho token refresh error:', error.response?.data || error.message);
      throw error;
    }
  }

app.get("/zoho-tasks", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await collection.findOne({ firebaseUid: req.user.uid });
    if (!user || !user.zohoRefreshToken) {
      return res.status(400).json({ error: "No Zoho refresh token found" });
    }

    try {
      const accessToken = await getZohoAccessToken(user.zohoRefreshToken);
      const zohoRegion = process.env.ZOHO_API_REGION || "com";
      const zohoApiBase = `https://www.zohoapis.${zohoRegion}`;

      const zohoResp = await axios.get(
        `${zohoApiBase}/crm/v2/Tasks`,
        {
          headers: { 
            Authorization: `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      res.json({ tasks: zohoResp.data.data || [] });
    } catch (err) {
      // If token is invalid, clear it and ask user to reconnect
      if (err.response?.data?.code === 'INVALID_TOKEN') {
        user.zohoRefreshToken = null;
        await user.save();
        return res.status(401).json({ 
          error: "Zoho token expired", 
          action: "reconnect" 
        });
      }
      throw err;
    }
  } catch (err) {
    console.error("Zoho tasks error:", err.response?.data || err.message);
    res.status(500).json({ 
      error: "Failed to fetch Zoho tasks", 
      details: err.response?.data || err.message 
    });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
