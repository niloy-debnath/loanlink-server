import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "https://your-live-site.netlify.app"],
    credentials: true,
  })
);

app.use(express.json());

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Create user
app.post("/users", async (req, res) => {
  try {
    const user = req.body;

    const existingUser = await mongoose.connection
      .collection("users")
      .findOne({ email: user.email });

    if (existingUser) {
      return res.json({ message: "User already exists" });
    }

    const result = await mongoose.connection
      .collection("users")
      .insertOne(user);

    res.json({ message: "User saved", result });
  } catch (error) {
    res.status(500).json({ message: "Failed to save user" });
  }
});

// Get user by email
app.get("/users/:email", async (req, res) => {
  const { email } = req.params;

  const user = await mongoose.connection.collection("users").findOne({ email });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json(user);
});

// Get all users
app.get("/users", async (req, res) => {
  try {
    const users = await mongoose.connection
      .collection("users")
      .find({})
      .toArray();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users", error: err });
  }
});

// Update user role
app.put("/users/:id/role", async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const result = await mongoose.connection
      .collection("users")
      .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { role } });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Role updated", result });
  } catch (err) {
    res.status(500).json({ message: "Failed to update role", error: err });
  }
});

// Suspend or un-suspend user
app.put("/users/:id/suspend", async (req, res) => {
  try {
    const { id } = req.params;
    const { suspended, reason } = req.body;

    const updateDoc = {
      suspended: suspended || false,
      suspendReason: reason || "",
    };

    const result = await mongoose.connection
      .collection("users")
      .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: updateDoc });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: `User ${suspended ? "suspended" : "unsuspended"}`,
      result,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to update suspension", error: err });
  }
});

// ---------- Loans Routes ----------

// GET all loans
app.get("/loans", async (req, res) => {
  try {
    const loans = await mongoose.connection
      .collection("loans")
      .find({})
      .toArray();

    res.json(loans);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch loans", error: err });
  }
});

// ADD NEW LOAN (Manager)
app.post("/loans", async (req, res) => {
  try {
    const loan = req.body;

    // Basic validation
    if (!loan.title || !loan.category || !loan.interestRate || !loan.maxLimit) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newLoan = {
      title: loan.title,
      shortDesc: loan.description || "",
      category: loan.category,
      interest: Number(loan.interestRate), // for existing UI
      interestRate: Number(loan.interestRate),
      maxLimit: Number(loan.maxLimit),
      image: loan.image || "",
      emiPlans: loan.emiPlans || [],
      requiredDocuments: loan.requiredDocuments || [],
      showOnHome: loan.showOnHome || false,
      createdBy: loan.createdBy,
      createdAt: new Date(),
    };

    const result = await mongoose.connection
      .collection("loans")
      .insertOne(newLoan);

    res.status(201).json({
      message: "Loan created successfully",
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error("Add Loan Error:", err);
    res.status(500).json({ message: "Failed to add loan" });
  }
});

// UpdateLoans
app.put("/loans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body }; // payload from frontend

    // Optionally: type conversion to prevent errors
    if (updateData.interestRate)
      updateData.interestRate = Number(updateData.interestRate);
    if (updateData.maxLimit) updateData.maxLimit = Number(updateData.maxLimit);
    if (updateData.showOnHome !== undefined)
      updateData.showOnHome = Boolean(updateData.showOnHome);

    console.log("Updating loan:", id, updateData); // DEBUG LOG

    const result = await mongoose.connection
      .collection("loans")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: updateData }
      );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Loan not found" });
    }

    res.json({ message: "Loan updated", result });
  } catch (err) {
    console.error("Update loan error:", err);
    res.status(500).json({ message: "Failed to update loan", error: err });
  }
});

// Loans visible on Home Page
app.get("/loans/home", async (req, res) => {
  try {
    const loans = await mongoose.connection
      .collection("loans")
      .find({
        showOnHome: { $in: [true, "true"] },
      })
      .toArray();

    res.json(loans);
  } catch (err) {
    console.error("Error fetching home loans:", err);
    res.status(500).json({ message: "Failed to fetch home loans" });
  }
});

// GET single loan by id
app.get("/loans/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const loan = await mongoose.connection
      .collection("loans")
      .findOne({ _id: new mongoose.Types.ObjectId(id) });

    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }

    res.json(loan);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch loan", error: err });
  }
});

// GET loans by manager
app.get("/loans/manager/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const loans = await mongoose.connection
      .collection("loans")
      .find({ createdBy: email })
      .toArray();

    res.json(loans);
  } catch (error) {
    console.error("Fetch manager loans error:", error);
    res.status(500).json({ message: "Failed to fetch manager loans" });
  }
});

// DELETE loan
app.delete("/loans/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await mongoose.connection
      .collection("loans")
      .deleteOne({ _id: new mongoose.Types.ObjectId(id) });

    res.json({ message: "Loan deleted", result });
  } catch (error) {
    console.error("Delete loan error:", error);
    res.status(500).json({ message: "Failed to delete loan" });
  }
});

// ---------- Loan Applications Routes ----------

// Create Loan Application
app.post("/loan-applications", async (req, res) => {
  try {
    const application = req.body;

    const result = await mongoose.connection
      .collection("loanapplications")
      .insertOne({
        ...application,
        applicationFeeStatus: "Unpaid",
        status: "Pending",
        createdAt: new Date(),
      });

    res.status(201).json({
      message: "Loan application created",
      insertedId: result.insertedId,
    });
  } catch (err) {
    res.status(500).json({
      message: "Failed to create loan application",
      error: err,
    });
  }
});

// GET all loan applications
app.get("/loan-applications", async (req, res) => {
  try {
    const applications = await mongoose.connection
      .collection("loanapplications")
      .find({})
      .toArray();
    res.json(applications);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch loan applications" });
  }
});

// GET all loan applications for a user
app.get("/loan-applications/user/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const applications = await mongoose.connection
      .collection("loanapplications")
      .find({ userEmail: email })
      .toArray();
    res.json(applications);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user loans", error: err });
  }
});

// Cancel Loan Application
app.put("/loan-applications/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await mongoose.connection
      .collection("loanapplications")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { status: "Cancelled" } }
      );
    if (result.matchedCount === 0)
      return res.status(404).json({ message: "Application not found" });

    res.json({ message: "Application cancelled", result });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to cancel application", error: err });
  }
});

// Pay application fee ($10)
app.post("/loan-applications/:id/pay", async (req, res) => {
  try {
    const { id } = req.params;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 1000,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
    });

    await mongoose.connection
      .collection("loanapplications")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $set: { paymentIntentId: paymentIntent.id } }
      );

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ message: "Payment creation failed", error: err });
  }
});

// Confirm payment
app.post("/loan-applications/:id/confirm-payment", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await mongoose.connection
      .collection("loanapplications")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        {
          $set: {
            applicationFeeStatus: "Paid",
            paidAt: new Date(),
          },
        }
      );

    res.json({ message: "Payment confirmed", result });
  } catch (err) {
    res.status(500).json({ message: "Failed to confirm payment" });
  }
});

// Get pending applications (Manager)
app.get("/loan-applications/pending", async (req, res) => {
  try {
    const result = await mongoose.connection
      .collection("loanapplications")
      .find({ status: "Pending" })
      .toArray();

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch pending loans" });
  }
});

// Update loan status (Approve / Reject)
app.put("/loan-applications/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const updateDoc = {
      status,
    };

    if (status === "Approved") {
      updateDoc.approvedAt = new Date();
    }

    const result = await mongoose.connection
      .collection("loanapplications")
      .updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: updateDoc });

    res.json({ message: "Status updated", result });
  } catch (err) {
    res.status(500).json({ message: "Failed to update status" });
  }
});

// Default route
app.get("/", (req, res) => res.send("Loan Link Backend Running..."));

// Start server
app.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
