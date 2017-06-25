require('dotenv').config({path: path.resolve(`${__dirname}/../../.env`)})
import express from 'express';
import session from 'express-session';
import path from 'path';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import logger from 'morgan';
import ShopifyToken from 'shopify-token';
import ejs from 'ejs';
import Shop from './shop';
import db from './db';
import mongoose from 'mongoose'
const MongoStore = require('connect-mongo')(session);

//Setting up Shopify App Credentials
const shopifyToken = new ShopifyToken({
  apiKey: process.env.SHOPIFY_APP_API_KEY,
  sharedSecret: process.env.SHOPIFY_APP_SECRET,
  redirectUri: process.env.SHOPIFY_REDIRECT_URI,
})

//The express app
let app =  express();
app.set('view engine', 'ejs');


app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
  store: new MongoStore({ mongooseConnection: mongoose.connection }),
  secret: 'keyboard cat',
  resave:false,
  saveUninitialized:false
}));
app.use(express.static(`${__dirname}/../public`))

// Shopify Authentication
app.get('/install', (req, res)=> {
  res.render(`${__dirname}/views/install.ejs`)
})

// This function initializes the Shopify OAuth Process
// The template in views/embedded_app_redirect.ejs is rendered 
app.get('/shopify_auth', (req, res) => {
  const shop = req.query.shop;
  if(shop){
    req.session.shopName = shop;
    const nonce = shopifyToken.generateNonce();
    const scopes = process.env.SHOPIFY_APP_SCOPES
    const authUrl = shopifyToken.generateAuthUrl(shop, scopes, nonce)
    res.render(`${__dirname}/views/redirect.ejs`, { authUrl })
  } else {
    res.status(400).send('Bad request: No shop param specified')
  }
})


// After the users clicks 'Install' on the Shopify website, they are redirected here
// Shopify provides the app the is authorization_code, which is exchanged for an access token
app.get('/callback', (req, res) => {
  const verified = shopifyToken.verifyHmac(req.query);
  if(verified){
    shopifyToken.getAccessToken(req.query.shop, req.query.code).then((token) => {
      req.session.token = token;

      const shop = new Shop(req.session.shopName, req.session.token);
      shop.addWebhook('products-update', 'products/update')
      shop.addScriptTag('scriptTag')

      res.redirect('/');
    }).catch((err) => console.err(err));
  }
})

// React
//The react app handles the rest of the urls
app.get('/', (req, res) => {
  if (req.session.token) {
    res.render(`${__dirname}/views/index.ejs`, {
      apiKey: process.env.SHOPIFY_APP_API_KEY,
      shopName: req.session.shopName
    })
  } else {
    res.redirect('/install');
  }
})

//Handles the hooks from shopify
app.post('/webhook/:hook', (req, res) => {
  if(req.params.hook === 'products-update') {
    db.Products.update({shopifyId: req.body.id}, {data:req.body}, (err, product)=> {
      if(err){
        res.status(400).send('ok')
      }else {
        res.status(200).send(product)
      }
    })
  }else {
    res.status(200).send('ok')
  }
})


app.get('/proxy/products/', (req, res) => {
  res.set('Content-Type', 'application/liquid');
  res.render(`${__dirname}/views/proxy.ejs`)
})


//The script served to the shop
app.get('/scriptTag', (req, res) => {
    if(req.query.shop){
      const shopName = req.query.shop.replace('.myshopify.com', '');
      db.Sliders
        .find({shopName})
        .populate('products')
        .exec( (err, sliders) =>{
          res.contentType('application/javascript')
          res.render(`${__dirname}/views/scriptTag.ejs`, {sliders});
        })
    } else {
      res.contentType('application/javascript')
      res.render(`${__dirname}/views/scriptTag.ejs`);
    }
    
});





//Routes as api for react
import apiRouter from './api';
app.use('/api', apiRouter)

const PORT = process.env.PORT || 3000; 
app.listen(PORT, ()=>{
  console.log(`Listening on port ${PORT}`)
}) 