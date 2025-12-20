import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import multer from "multer";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

/* ===================== MIDDLEWARE ===================== */
app.use(
  cors({
    origin: ["http://localhost:5173", "https://your-live-site.netlify.app"],
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static("uploads"));

/* ===================== MULTER CONFIG ===================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/profile-images";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.id}${ext}`);
  },
});
const upload = multer({ storage });

/* ===================== STRIPE ===================== */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ===================== DB ===================== */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

/* =====================================================
   USERS
===================================================== */
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const users = mongoose.connection.collection("users");

    const existingUser = await users.findOne({ email: user.email });

    if (existingUser) {
      // 🔒 DO NOT TOUCH ROLE IF NOT PROVIDED
      const updateDoc = {
        name: user.name,
        photoURL: user.photoURL,
        status: user.status,
      };

      if (user.role) {
        updateDoc.role = user.role;
      }

      await users.updateOne({ email: user.email }, { $set: updateDoc });

      return res.json({ message: "User synced safely" });
    }

    // New user
    await users.insertOne({
      ...user,
      role: user.role || "borrower",
    });

    res.json({ message: "User created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save user" });
  }
});

app.get("/users/:email", async (req, res) => {
  const user = await mongoose.connection
    .collection("users")
    .findOne({ email: req.params.email });

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json(user);
});

app.get("/users", async (req, res) => {
  const users = await mongoose.connection
    .collection("users")
    .find({})
    .toArray();
  res.json(users);
});

app.put("/users/:id/role", async (req, res) => {
  const result = await mongoose.connection
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: { role: req.body.role } }
    );

  if (!result.matchedCount)
    return res.status(404).json({ message: "User not found" });

  res.json({ message: "Role updated" });
});

/* ---------- UPDATE PROFILE IMAGE ---------- */
app.put("/users/:id/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ message: "No image uploaded" });

    const imagePath = `/uploads/profile-images/${req.file.filename}`;

    const result = await mongoose.connection
      .collection("users")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(req.params.id) },
        { $set: { image: imagePath } }
      );

    if (!result.matchedCount)
      return res.status(404).json({ message: "User not found" });

    res.json({ message: "Profile image updated", image: imagePath });
  } catch (err) {
    res.status(500).json({ message: "Failed to update profile image" });
  }
});

/* ---------- SUSPEND USER ---------- */
app.put("/users/:id/suspend", async (req, res) => {
  const result = await mongoose.connection.collection("users").updateOne(
    { _id: new mongoose.Types.ObjectId(req.params.id) },
    {
      $set: {
        suspended: req.body.suspended || false,
        suspendReason: req.body.reason || "",
      },
    }
  );

  if (!result.matchedCount)
    return res.status(404).json({ message: "User not found" });

  res.json({
    message: `User ${req.body.suspended ? "suspended" : "unsuspended"}`,
  });
});

/* =====================================================
   LOANS
===================================================== */
app.get("/loans", async (req, res) => {
  const loans = await mongoose.connection
    .collection("loans")
    .find({})
    .toArray();
  res.json(loans);
});

app.get("/loans/home", async (req, res) => {
  const loans = await mongoose.connection
    .collection("loans")
    .find({ showOnHome: { $in: [true, "true"] } })
    .toArray();
  res.json(loans);
});

app.get("/loans/:id", async (req, res) => {
  const loan = await mongoose.connection
    .collection("loans")
    .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });

  if (!loan) return res.status(404).json({ message: "Loan not found" });
  res.json(loan);
});

app.get("/loans/manager/:email", async (req, res) => {
  const loans = await mongoose.connection
    .collection("loans")
    .find({ createdBy: req.params.email })
    .toArray();
  res.json(loans);
});

app.post("/loans", async (req, res) => {
  const loan = {
    ...req.body,
    interestRate: Number(req.body.interestRate),
    interest: Number(req.body.interestRate),
    maxLimit: Number(req.body.maxLimit),
    createdAt: new Date(),
  };

  const result = await mongoose.connection.collection("loans").insertOne(loan);

  res.status(201).json(result);
});

app.put("/loans/:id", async (req, res) => {
  await mongoose.connection
    .collection("loans")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: req.body }
    );
  res.json({ message: "Loan updated" });
});

app.delete("/loans/:id", async (req, res) => {
  await mongoose.connection
    .collection("loans")
    .deleteOne({ _id: new mongoose.Types.ObjectId(req.params.id) });
  res.json({ message: "Loan deleted" });
});

/* =====================================================
   LOAN APPLICATIONS
===================================================== */
app.post("/loan-applications", async (req, res) => {
  const result = await mongoose.connection
    .collection("loanapplications")
    .insertOne({
      ...req.body,
      status: "Pending",
      applicationFeeStatus: "Unpaid",
      createdAt: new Date(),
    });
  res.status(201).json(result);
});

app.get("/loan-applications", async (req, res) => {
  const apps = await mongoose.connection
    .collection("loanapplications")
    .find({})
    .toArray();
  res.json(apps);
});

app.get("/loan-applications/user/:email", async (req, res) => {
  const apps = await mongoose.connection
    .collection("loanapplications")
    .find({ userEmail: req.params.email })
    .toArray();
  res.json(apps);
});

app.get("/loan-applications/pending", async (req, res) => {
  const apps = await mongoose.connection
    .collection("loanapplications")
    .find({ status: "Pending" })
    .toArray();
  res.json(apps);
});

app.put("/loan-applications/:id/status", async (req, res) => {
  await mongoose.connection.collection("loanapplications").updateOne(
    { _id: new mongoose.Types.ObjectId(req.params.id) },
    {
      $set: {
        status: req.body.status,
        approvedAt: req.body.status === "Approved" ? new Date() : null,
      },
    }
  );
  res.json({ message: "Status updated" });
});

/* ---------- STRIPE PAYMENT ---------- */
app.post("/loan-applications/:id/pay", async (req, res) => {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: 1000,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
  });

  await mongoose.connection
    .collection("loanapplications")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: { paymentIntentId: paymentIntent.id } }
    );

  res.json({ clientSecret: paymentIntent.client_secret });
});

app.post("/loan-applications/:id/confirm-payment", async (req, res) => {
  await mongoose.connection.collection("loanapplications").updateOne(
    { _id: new mongoose.Types.ObjectId(req.params.id) },
    {
      $set: {
        applicationFeeStatus: "Paid",
        paidAt: new Date(),
      },
    }
  );
  res.json({ message: "Payment confirmed" });
});

/* ===================== ROOT ===================== */
app.get("/", (req, res) => res.send("Loan Link Backend Running..."));

app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
