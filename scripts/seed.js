// Database seeder script
require('dotenv').config({ path: '../config/.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Usuario = require('../src/models/usuario');
const Proyecto = require('../src/models/proyecto');

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB for seeding...');

    // Clear existing data
    await Usuario.deleteMany({});
    await Proyecto.deleteMany({});

    // Create admin user
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    const admin = new Usuario({
      nombre: 'Admin',
      email: 'admin@example.com',
      contraseña: hashedPassword,
      rol: 'admin'
    });

    await admin.save();

    // Create regular user
    const user = new Usuario({
      nombre: 'Usuario de Prueba',
      email: 'usuario@example.com',
      contraseña: hashedPassword
    });

    await user.save();

    // Create sample project
    const project = new Proyecto({
      nombre: 'Proyecto de Ejemplo',
      descripcion: 'Este es un proyecto de ejemplo',
      creador: admin._id,
      colaboradores: [user._id],
      estado: 'en_progreso'
    });

    await project.save();

    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
