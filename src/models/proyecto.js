const mongoose = require('mongoose');

const proyectoSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  descripcion: {
    type: String,
    required: true
  },
  creador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario',
    required: true
  },
  colaboradores: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  }],
  fechaInicio: {
    type: Date,
    default: Date.now
  },
  fechaFin: {
    type: Date
  },
  estado: {
    type: String,
    enum: ['pendiente', 'en_progreso', 'completado', 'cancelado'],
    default: 'pendiente'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Proyecto', proyectoSchema);
