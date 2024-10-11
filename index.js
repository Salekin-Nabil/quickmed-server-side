const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 7000;

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

    const verifyAdmin = async (req, res, next) => {
        const decodedEmail = req.decoded.email;
        const query = { email: decodedEmail };
        const user = await usersCollection.findOne(query);

        if (user?.role !== 'admin') {
            return res.status(403).send({ message: 'forbidden access' })
        }
        next();
    }

    app.get('/service', async(req,res)=>{
        const query = {};
        const cursor = serviceCollection.find(query);
        const services = await cursor.toArray();
        res.send(services);
    })

  //   app.get('/bookings', async (req, res) => {
  //     // const email = req.query.email;
  //     // const decodedEmail = req.decoded.email;

  //     // if (email !== decodedEmail) {
  //     //     return res.status(403).send({ message: 'forbidden access' });
  //     // }

  //     // const query = { email: email };
  //     const query = { email: email };
  //     const bookings = await bookingsCollection.find(query).toArray();
  //     res.send(bookings);
  // });

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

app.get('/users/admin/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send({ isAdmin: user?.role === 'admin' });
});

app.delete('/users/:email', verifyJWT, verifyAdmin, async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const result = await usersCollection.deleteOne(query);
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