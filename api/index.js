import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import admin from "../firebaseAdmin.js";
import connectDB from "../db.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

/* ===================== DB ===================== */
let dbReady = false;

app.use(async (req, res, next) => {
  if (!dbReady) {
    try {
      await connectDB();
      dbReady = true;
    } catch (err) {
      console.error("DB ERROR:", err);
      return res.status(500).send("Database connection failed");
    }
  }
  next();
});

/* ===================== MIDDLEWARE ===================== */
app.use(
  cors({
    origin: ["http://localhost:5173", "https://loanlink-client.vercel.app"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

/* ===================== JWT MIDDLEWARE ===================== */
const verifyJWT = (req, res, next) => {
  console.log("COOKIES:", req.cookies);

  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Unauthorized" });
    req.user = decoded;
    next();
  });
};

/* ===================== STRIPE ===================== */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ===================== AUTH ROUTES ===================== */
app.get("/test-firebase", async (req, res) => {
  try {
    const users = await admin.auth().listUsers(1);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/jwt", async (req, res) => {
  const { firebaseToken } = req.body;
  console.log("jwt body:", req.body);

  try {
    const decodedUser = await admin.auth().verifyIdToken(firebaseToken);

    const token = jwt.sign(
      { email: decodedUser.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // res.cookie("token", token, {
    //   httpOnly: true,
    //   secure: true,
    //   sameSite: "none",
    // });
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      path: "/",
    });

    res.json({ success: true });
  } catch {
    res.status(401).json({ message: "Invalid Firebase token" });
  }
});

app.post("/logout", (req, res) => {
  // res.clearCookie("token", {
  //   secure: true,
  //   sameSite: "none",
  // });
  res.clearCookie("token", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "none",
    path: "/",
  });

  res.json({ message: "Logged out" });
});

/* =====================================================
   USERS
===================================================== */
app.post("/users", async (req, res) => {
  try {
    const user = req.body;
    const users = mongoose.connection.collection("users");

    const existingUser = await users.findOne({ email: user.email });

    if (existingUser) {
      const updateDoc = {
        name: user.name,
        photoURL: user.photoURL,
        status: user.status,
      };
      if (user.role) updateDoc.role = user.role;

      await users.updateOne({ email: user.email }, { $set: updateDoc });
      return res.json({ message: "User synced safely" });
    }

    await users.insertOne({ ...user, role: user.role || "borrower" });
    res.json({ message: "User created" });
  } catch {
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

app.put("/users/:id", verifyJWT, async (req, res) => {
  const result = await mongoose.connection
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: req.body }
    );

  if (!result.matchedCount)
    return res.status(404).json({ message: "User not found" });

  res.json({ message: "Profile updated successfully" });
});

app.get("/users", verifyJWT, async (req, res) => {
  const users = await mongoose.connection
    .collection("users")
    .find({})
    .toArray();
  res.json(users);
});

app.put("/users/:id/role", verifyJWT, async (req, res) => {
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

app.put("/users/:id/image", verifyJWT, async (req, res) => {
  const { photoURL } = req.body;
  if (!photoURL) return res.status(400).json({ message: "photoURL required" });

  const result = await mongoose.connection
    .collection("users")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: { photoURL } }
    );

  if (!result.matchedCount)
    return res.status(404).json({ message: "User not found" });

  res.json({ message: "Profile image updated", photoURL });
});

app.put("/users/:id/suspend", verifyJWT, async (req, res) => {
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

app.get("/loans/manager/:email", verifyJWT, async (req, res) => {
  const loans = await mongoose.connection
    .collection("loans")
    .find({ createdBy: req.params.email })
    .toArray();
  res.json(loans);
});

app.post("/loans", verifyJWT, async (req, res) => {
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

app.put("/loans/:id", verifyJWT, async (req, res) => {
  await mongoose.connection
    .collection("loans")
    .updateOne(
      { _id: new mongoose.Types.ObjectId(req.params.id) },
      { $set: req.body }
    );
  res.json({ message: "Loan updated" });
});

app.delete("/loans/:id", verifyJWT, async (req, res) => {
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

/* ---------- CANCEL LOAN APPLICATION ---------- */
app.put("/loan-applications/:id/cancel", verifyJWT, async (req, res) => {
  try {
    const loan = await mongoose.connection
      .collection("loanapplications")
      .findOne({ _id: new mongoose.Types.ObjectId(req.params.id) });

    if (!loan) {
      return res.status(404).json({ message: "Loan application not found" });
    }

    if (loan.status !== "Pending") {
      return res
        .status(400)
        .json({ message: "Only pending applications can be cancelled" });
    }

    await mongoose.connection
      .collection("loanapplications")
      .updateOne(
        { _id: loan._id },
        { $set: { status: "Cancelled", cancelledAt: new Date() } }
      );

    res.json({ message: "Loan application cancelled successfully" });
  } catch (err) {
    console.error("CANCEL LOAN ERROR:", err);
    res.status(500).json({ message: "Failed to cancel loan application" });
  }
});

app.get("/loan-applications/pending", verifyJWT, async (req, res) => {
  const apps = await mongoose.connection
    .collection("loanapplications")
    .find({ status: "Pending" })
    .toArray();
  res.json(apps);
});

app.put("/loan-applications/:id/status", verifyJWT, async (req, res) => {
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
app.post("/loan-applications/:id/pay", verifyJWT, async (req, res) => {
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

app.post(
  "/loan-applications/:id/confirm-payment",
  verifyJWT,
  async (req, res) => {
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
  }
);

/* ===================== ROOT ===================== */
app.get("/", (req, res) => res.send("Loan Link Backend Running..."));

export default app;
// export const config = {
//   api: {
//     bodyParser: false,
//   },
// };
