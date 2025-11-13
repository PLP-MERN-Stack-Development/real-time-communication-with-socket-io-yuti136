const jwt = require('jsonwebtoken');
const { log } = require('../utils/logger');
const secret = process.env.JWT_SECRET || 'dev_secret_change_me';
const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

function login(req, res) {
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'username required' });
  const payload = { username };
  const token = jwt.sign(payload, secret, { expiresIn });
  log('login:', username);
  return res.json({ token, username });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}

module.exports = { login, verifyToken };
