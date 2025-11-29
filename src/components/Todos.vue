<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource'; // Ajuste o caminho conforme sua pasta

// 1. Inicializar Cliente Amplify
const client = generateClient<Schema>();

// --- ESTADO (Variaveis Reativas) ---
const subjects = ref<Array<Schema['Subject']['type']>>([]);
const activities = ref<Array<Schema['Activity']['type']>>([]);
const notes = ref<Array<Schema['Note']['type']>>([]);
const currentNoteInput = ref('');

// Formulários
const newSubjectName = ref('');
const newSubjectColor = ref('#3498db');
const newActivityTitle = ref('');
const newActivityDate = ref(new Date().toISOString().split('T')[0]);
const selectedSubjectId = ref('');

// Filtros
const filterSubjectId = ref('all'); // 'all' ou ID da matéria

// --- LÓGICA (Actions) ---

// Carregar dados ao iniciar
async function loadData() {
  // Buscar matérias
  const subData = await client.models.Subject.list();
  subjects.value = subData.data;

  // Buscar atividades (aqui pegamos tudo, mas em produção filtrariamos por data no backend)
  const actData = await client.models.Activity.list();
  activities.value = actData.data;

  // Buscar notas
  const noteData = await client.models.Note.list();
  notes.value = noteData.data;
}

// Criar Matéria
async function createSubject() {
  if (!newSubjectName.value) return;
  
  const { data: newSub } = await client.models.Subject.create({
    name: newSubjectName.value,
    color: newSubjectColor.value
  });
  
  if (newSub) subjects.value.push(newSub);
  newSubjectName.value = '';
}

// Criar Atividade
async function createActivity() {
  if (!newActivityTitle.value || !selectedSubjectId.value) return;

  const { data: newAct } = await client.models.Activity.create({
    title: newActivityTitle.value,
    date: newActivityDate.value,
    subjectId: selectedSubjectId.value
  });

  if (newAct) {
    // Precisamos recarregar para trazer o relacionamento 'subject' populado ou fazer push manual
    loadData(); 
  }
}

// Criar/Salvar Nota
async function addNote() {
  if (!currentNoteInput.value) return;
  const { data: newNote } = await client.models.Note.create({
    content: currentNoteInput.value
  });
  if (newNote) notes.value.push(newNote);
  currentNoteInput.value = '';
}

// --- COMPUTED (Lógica de Filtro no Frontend) ---
const filteredActivities = computed(() => {
  let list = activities.value;

  // 1. Filtro por Matéria
  if (filterSubjectId.value !== 'all') {
    list = list.filter(a => a.subjectId === filterSubjectId.value);
  }

  // 2. Ordenar por data
  return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
});

// Executar ao montar o componente
onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="dashboard-container">
    
    <aside class="sidebar">
      <h2>📚 Meus Estudos</h2>
      
      <div class="notepad-section">
        <h3>📝 Bloquinho Rápido</h3>
        <div class="notes-list">
          <div v-for="note in notes" :key="note.id" class="note-card">
            {{ note.content }}
          </div>
        </div>
        <div class="add-note">
          <textarea v-model="currentNoteInput" placeholder="Anotar algo..."></textarea>
          <button @click="addNote">Salvar Nota</button>
        </div>
      </div>

      <div class="subject-creator">
        <h3>Nova Matéria</h3>
        <input v-model="newSubjectName" placeholder="Nome (ex: Algoritmos)" />
        <input type="color" v-model="newSubjectColor" />
        <button @click="createSubject">Adicionar</button>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar">
        <h1>Agenda Acadêmica</h1>
        
        <select v-model="filterSubjectId">
          <option value="all">Todas as Matérias</option>
          <option v-for="sub in subjects" :key="sub.id" :value="sub.id">
            {{ sub.name }}
          </option>
        </select>
      </header>

      <section class="new-activity-form">
        <input type="date" v-model="newActivityDate" />
        <input v-model="newActivityTitle" placeholder="O que tem pra fazer?" />
        <select v-model="selectedSubjectId">
          <option disabled value="">Selecione a Matéria</option>
          <option v-for="sub in subjects" :key="sub.id" :value="sub.id">
            {{ sub.name }}
          </option>
        </select>
        <button @click="createActivity">Agendar</button>
      </section>

      <div class="activities-grid">
        <div v-if="filteredActivities.length === 0" class="empty-state">
          Nenhuma atividade encontrada para este filtro.
        </div>

        <div 
          v-for="activity in filteredActivities" 
          :key="activity.id" 
          class="activity-card"
          :style="{ borderLeft: `5px solid ${subjects.find(s => s.id === activity.subjectId)?.color || '#ccc'}` }"
        >
          <div class="date-badge">
            {{ new Date(activity.date).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }) }}
          </div>
          <div class="details">
            <strong>{{ activity.title }}</strong>
            <span class="subject-tag">
              {{ subjects.find(s => s.id === activity.subjectId)?.name }}
            </span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
/* CSS Básico para Layout */
.dashboard-container {
  display: grid;
  grid-template-columns: 300px 1fr;
  height: 100vh;
  font-family: 'Segoe UI', sans-serif;
  color: #333;
}

/* Sidebar */
.sidebar {
  background-color: #f4f4f9;
  padding: 20px;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.notes-list {
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.note-card {
  background: #fff6b0; /* Cor de post-it */
  padding: 10px;
  margin-bottom: 5px;
  border-radius: 4px;
  box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
  font-size: 0.9em;
}

textarea {
  width: 100%;
  height: 60px;
  margin-bottom: 5px;
}

/* Main */
.main-content {
  padding: 30px;
  overflow-y: auto;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

/* Activity Form */
.new-activity-form {
  background: #fff;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
  display: flex;
  gap: 10px;
  margin-bottom: 30px;
}

/* Cards de Atividade */
.activities-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-card {
  display: flex;
  align-items: center;
  background: white;
  padding: 15px;
  border-radius: 6px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.05);
  transition: transform 0.2s;
}

.activity-card:hover {
  transform: translateX(5px);
}

.date-badge {
  background: #eee;
  padding: 5px 10px;
  border-radius: 4px;
  font-weight: bold;
  margin-right: 15px;
  text-transform: uppercase;
  font-size: 0.8em;
}

.details {
  display: flex;
  flex-direction: column;
}

.subject-tag {
  font-size: 0.8em;
  color: #666;
}

/* Botões e Inputs gerais */
input, select, button {
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

button {
  background-color: #3498db;
  color: white;
  border: none;
  cursor: pointer;
}

button:hover {
  background-color: #2980b9;
}
</style>