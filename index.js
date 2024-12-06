const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eqli7da.mongodb.net/?retryWrites=true&w=majority`;
console.log(uri);

const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
      
    },
  });

  function verifyJWT(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("quick_med").command({ ping: 1 });
    const serviceCollection = client.db('quick_med').collection('services');
    const reviewCollection = client.db('quick_med').collection('reviews');
    const bookingsCollection = client.db('quick_med').collection('bookings');
    const usersCollection = client.db('quick_med').collection('users');
    const doctorsCollection = client.db('quick_med').collection('doctors');
    const paymentCollection = client.db('quick_med').collection('payment');
    // const callCollection = client.db('quick_med').collection('call');

    const verifyAdmin = async (req, res, next) => {
        const decodedEmail = req.decoded.email;
        const query = { email: decodedEmail };
        const user = await usersCollection.findOne(query);

        if (user?.role !== 'admin') {
            return res.status(403).send({ message: 'forbidden access' })
        }
        next();
    }

    const verifyDoctor = async (req, res, next) => {
        const decodedEmail = req.decoded.email;
        const query = { email: decodedEmail };
        const user = await doctorsCollection.findOne(query);

        if (user?.role !== 'doctor') {
            return res.status(403).send({ message: 'forbidden access' })
        }
        next();
    }

    app.get('/service', async(req,res)=>{
        const query = {};
        const cursor = serviceCollection.find(query);
        const services = await cursor.toArray();
        res.send(services);
    });

    // app.get('/calls', async(req,res)=>{
    //     const query = {};
    //     const cursor = callCollection.find(query);
    //     const services = await cursor.toArray();
    //     res.send(services);
    // });

    app.put('/bookings/calls/started/:appointmentID', async (req, res) => {
        const appointmentID = req.params.appointmentID;
        const filter = { _id: new ObjectId(appointmentID) };
        const options = { upsert: true };
        const updateDoc = {
          $set: {
            status: 'ongoing'
        },
        };
        const result = await bookingsCollection.updateOne(filter, updateDoc, options);
        res.send({ result });
      });

    app.put('/bookings/calls/ended/:appointmentID', async (req, res) => {
        const appointmentID = req.params.appointmentID;
        const filter = { _id: new ObjectId(appointmentID) };
        const options = { upsert: true };
        const updateDoc = {
          $set: {
            status: 'completed'
        },
        };
        const result = await bookingsCollection.updateOne(filter, updateDoc, options);
        res.send({ result });
      });

  app.post('/bookings', async (req, res) => {
    const booking = req.body;
    console.log(booking); 
    const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        service: booking.service
    }

    const alreadyBooked = await bookingsCollection.find(query).toArray();

    if (alreadyBooked.length) {
        const message = `You already have a booking on ${booking.appointmentDate}`
        return res.send({ acknowledged: false, message })
    }

    const result = await bookingsCollection.insertOne(booking);
    res.send(result);
});

app.get('/v2/appointmentOptions', async (req, res) => {
  const date = req.query.date;
  const options = await serviceCollection.aggregate([
      {
          $lookup: {
              from: 'bookings',
              localField: 'name',
              foreignField: 'service',
              pipeline: [
                  {
                      $match: {
                          $expr: {
                              $eq: ['$appointmentDate', date]
                          }
                      }
                  }
              ],
              as: 'booked'
          }
      },
      {
          $project: {
              name: 1,
              price: 1,
              slots: 1,
              booked: {
                  $map: {
                      input: '$booked',
                      as: 'book',
                      in: '$$book.slot'
                  }
              }
          }
      },
      {
          $project: {
              name: 1,
              price: 1,
              slots: {
                  $setDifference: ['$slots', '$booked']
              }
          }
      }
  ]).toArray();
  res.send(options);
});

app.get('/bookings', verifyJWT, async (req, res) => {
    const email = req.query.email;
    const decodedEmail = req.decoded.email;

    if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' });
    }

    const query = { email: email };
    const bookings = await bookingsCollection.find(query).toArray();
    res.send(bookings);
});

app.delete('/bookings/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const result = await bookingsCollection.deleteMany(query);
    res.send(result);
});

app.delete('/bookings/:id', verifyJWT, async (req, res) => {
    const id = req.params.id;
    console.log(id);
    const filter = { _id: new ObjectId(id) }
    const result = await bookingsCollection.deleteOne(filter);
    res.send(result);
});

app.get('/all_bookings', verifyJWT, verifyAdmin, async (req, res) => {
    const query = {};
    const bookings = await bookingsCollection.find(query).toArray();
    res.send(bookings);
});

app.get('/all_bookings_for_doctor', verifyJWT, verifyDoctor, async (req, res) => {
    const service = req.query.service;
    const query = {service:service};
    const bookings = await bookingsCollection.find(query).toArray();
    res.send(bookings);
});

app.put("/user/:email", async(req,res) =>{
    const email = req.params.email;
    const user = req.body;
    const filter = {email:email};
    const options = {upsert: true};
    const updateDoc = {
        $set: user,
    };
    const result = await usersCollection.updateOne(filter, updateDoc, options);
    const token = jwt.sign({email: email}, process.env.ACCESS_TOKEN_SECRET, {expiresIn: '1h'});
    res.send({result, token});
});

app.get('/users', verifyJWT, async (req, res) => {
    const query = {};
    const users = await usersCollection.find(query).toArray();
    res.send(users);
});

app.put('/users/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    // const filter = { _id: ObjectId(id) }
    const filter = { email: email };
    const options = { upsert: true };
    const updatedDoc = {
        $set: {
            role: 'admin'
        }
    }
    const result = await usersCollection.updateOne(filter, updatedDoc, options);
    res.send(result);
});

//Approve doctor's application
app.put('/doctor/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    // const filter = { _id: ObjectId(id) }
    const filter = { email: email };
    const options = { upsert: true };
    const updatedDoc = {
        $set: {
            role: 'doctor'
        }
    }
    const result = await doctorsCollection.updateOne(filter, updatedDoc, options);
    res.send(result);
});

// app.put('/users/profile_creation/:email', async (req, res) => {
//     const email = req.params.email;
//     // const filter = { _id: ObjectId(id) }
//     const filter = { email: email };
//     const options = { upsert: true };
//     const updatedDoc = {
//         $set: {
//             profileCreated: True
//         }
//     }
//     const result = await usersCollection.updateOne(filter, updatedDoc, options);
//     res.send(result);
// });

//Routing as an Admin
app.get('/users/admin/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send({ isAdmin: user?.role === 'admin' });
});

//Finding a User by Email
app.get('/users/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send(user);
});

//Finding a User by ID
app.get('/users/id/:id', async (req, res) => {
  const id = req.params.id;
  const query = {_id: new ObjectId(id)};
    const user = await usersCollection.findOne(query);
    res.send(user);
});

//Routing as a Doctor
app.get('/users/doctor/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await doctorsCollection.findOne(query);
    res.send({ isDoctor: user?.role === 'doctor' });
});

//Remove an User
app.delete('/users/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const result = await usersCollection.deleteOne(query);
    res.send(result);
});

//Remove a Doctor
app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const result = await doctorsCollection.deleteOne(query);
    res.send(result);
});

//Reviews PUT API
app.put('/reviews/:email', async (req, res) => {
    const email = req.params.email;
    const newReview = req.body;
    const filter = { email: email };
    const options = { upsert: true };
    const updateDoc = {
      $set: newReview,
    };
    const result = await reviewCollection.updateOne(filter, updateDoc, options);
    res.send({ result });
  });

//Get Wallet Address GET API
app.get('/users/wallet/:email', verifyJWT, verifyDoctor, async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    console.log("Wallet: ", user.data.walletAddress);
    res.send(user.data);
  });

//Inserting Wallet Address PUT API
app.put('/users/wallet/:email', async (req, res) => {
    const email = req.params.email;
    const data = req.body;
    console.log("Data: ", data);
    const filter = { email: email };
    const options = { upsert: true };
    const updatedDoc = {
        $set: {
            profileCreated: "True",
            data
        }
    }
    const result = await usersCollection.updateOne(filter, updatedDoc, options);
    res.send(result);
  });

//New application for being a doctor
app.put('/doctor/:email', async (req, res) => {
    const email = req.params.email;
    const newDoctor = req.body;
    const filter = { email: email };
    const options = { upsert: true };
    const updateDoc = {
      $set: newDoctor,
    };
    const result = await doctorsCollection.updateOne(filter, updateDoc, options);
    res.send({ result });
  });

  //Reviews GET API latest 6 reviews
  app.get('/reviews_3', async (req, res)=>{
    const cursor = reviewCollection.find({}).sort({_id:-1}).limit(3);
    const reviews = await cursor.toArray();
    res.send(reviews);
});

  //Reviews GET API all reviews
  app.get('/reviews', async (req, res)=>{
    const cursor = reviewCollection.find({}).sort({_id:-1});
    const reviews = await cursor.toArray();
    res.send(reviews);
});

//Get all doctors
  app.get('/doctors', async (req, res)=>{
    const cursor = doctorsCollection.find({}).sort({_id:-1});
    const doctors = await cursor.toArray();
    res.send(doctors);
});

app.get('/doctors_info', verifyJWT, verifyDoctor, async (req, res) => {
    const email = req.query.email;
    const decodedEmail = req.decoded.email;

    if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' });
    }

    const query = { email: email };
    const userInfo = await doctorsCollection.find(query).toArray();
    res.send(userInfo);
});

//Payment POST API
app.post('/create-payment-intent', verifyJWT, async(req, res) =>{
    const booking = req.body;
    const bill = booking.bill;
    const amount = bill;
    const paymentIntent = await stripe.paymentIntents.create({
      amount : amount,
      currency: 'usd',
      payment_method_types:['card']
    });
    res.send({clientSecret: paymentIntent.client_secret})
  });

  //Single booking GET API
  app.get('/bookings/:id', verifyJWT, async(req, res) =>{
    const id = req.params.id;
    const query = {_id: new ObjectId(id)};
    const booking = await bookingsCollection.findOne(query);
    res.send(booking);
  });

  //Payment confirmation PATCH API
  app.patch('/bookings/:id', verifyJWT, async(req, res) =>{
    const id  = req.params.id;
    const payment = req.body;
    const filter = {_id: new ObjectId(id)};
    const updatedDoc = {
      $set: {
        status: "pending",
        transactionId: payment.transactionId
      }
    }
    const result = await paymentCollection.insertOne(payment);
    const updatedBooking = await bookingsCollection.updateOne(filter, updatedDoc);
    res.send(updatedBooking);
  });

  //Crypto payment confirmation PATCH API
  app.patch('/bookings/crypto/:id', verifyJWT, async(req, res) =>{
    const id  = req.params.id;
    const payment = req.body;
    const filter = {_id: new ObjectId(id)};
    const updatedDoc = {
      $set: {
        status: "pending",
        transactionId: payment.transactionID
      }
    }
    const result = await paymentCollection.insertOne(payment);
    const updatedBooking = await bookingsCollection.updateOne(filter, updatedDoc);
    res.send(updatedBooking);
  });

  //Accept Appointment API
  app.patch('/bookings_accepted/:id', verifyJWT, verifyDoctor, async(req, res) =>{
    const id  = req.params.id;
    const filter = {_id: new ObjectId(id)};
    const updatedDoc = {
      $set: {
        status: "accepted",
      }
    }
    const updatedBooking = await bookingsCollection.updateOne(filter, updatedDoc);
    res.send(updatedBooking);
  });

// app.get('/bookings', async (req, res) => {
//     // const email = req.query.email;
//     // const decodedEmail = req.decoded.email;

//     // if (email !== decodedEmail) {
//     //     return res.status(403).send({ message: 'forbidden access' });
//     // }

//     const query = {};
//     const cursor = bookingsCollection.find(query);
//     const bookings = await cursor.toArray();
//     res.send(bookings);
// });

    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello From QuickMed own portal!')
})

app.listen(port, () => {
  console.log(`QuickMed App listening on port ${port}`)
})