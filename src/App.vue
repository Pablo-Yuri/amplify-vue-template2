<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { generateClient } from 'aws-amplify/data';
import { Authenticator } from '@aws-amplify/ui-vue';
import '@aws-amplify/ui-vue/styles.css';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();

// --- ESTADO ---
const subjects = ref<Array<Schema['Subject']['type']>>([]);
const activities = ref<Array<Schema['Activity']['type']>>([]);
const notes = ref<any[]>([]);

// Inputs
const newSubjectName = ref('');
const newSubjectColor = ref('#3498db');
const newActivityTitle = ref('');
const newActivityDate = ref(new Date().toISOString().split('T')[0]);
const selectedSubjectId = ref('');
const currentNoteInput = ref('');

// Filtros
const filterSubjectId = ref('all');
const showOnlyCurrentWeek = ref(false);

// --- CARREGAMENTO INICIAL ---
async function loadData() {
  const subData = await client.models.Subject.list();
  subjects.value = subData.data;

  const actData = await client.models.Activity.list();
  activities.value = actData.data;

  const noteData = await client.models.Note.list();
  notes.value = noteData.data;
}

// --- FUNÇÕES DE CRIAÇÃO ---

// 1. Criar Matéria
async function createSubject() {
  if (!newSubjectName.value) return;
  const { data } = await client.models.Subject.create({
    name: newSubjectName.value,
    color: newSubjectColor.value
  });
  if (data) {
    subjects.value.push(data);
    newSubjectName.value = '';
  }
}

// 2. Criar Atividade (Com vínculo)
async function createActivity() {
  if (!newActivityTitle.value || !selectedSubjectId.value) return alert("Preencha título e matéria");
  const { data } = await client.models.Activity.create({
    title: newActivityTitle.value,
    date: newActivityDate.value,
    subjectId: selectedSubjectId.value
  });
  if (data) {
    // Recarregar para garantir os vínculos
    loadData();
    newActivityTitle.value = '';
  }
}

// 3. Criar Nota (Bloquinho)
async function addNote() {
  if (!currentNoteInput.value) return;
  const { data } = await client.models.Note.create({ content: currentNoteInput.value });
  if (data) {
    notes.value.push(data);
    currentNoteInput.value = '';
  }
}

async function deleteNote(id: string) {
  await client.models.Note.delete({ id });
  notes.value = notes.value.filter(n => n.id !== id);
}

// --- LÓGICA DE FILTROS ---
const filteredActivities = computed(() => {
  let list = activities.value;

  // Filtro Matéria
  if (filterSubjectId.value !== 'all') {
    list = list.filter(a => a.subjectId === filterSubjectId.value);
  }

  // Filtro Semana
  if (showOnlyCurrentWeek.value) {
    const hoje = new Date();
    const diaSemana = hoje.getDay(); // 0-6
    const inicio = new Date(hoje);
    inicio.setDate(hoje.getDate() - diaSemana);
    inicio.setHours(0,0,0,0);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23,59,59,999);

    list = list.filter(a => {
      const d = new Date(a.date);
      // Ajuste básico de timezone (adicionando 3h para compensar UTC se necessário)
      d.setHours(d.getHours() + 3); 
      return d >= inicio && d <= fim;
    });
  }

  // Ordenar por data
  return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
});

onMounted(() => loadData());
</script>

<template>
  <authenticator>
    <template v-slot="{ signOut, user }">
      <div class="layout">
        
        <aside class="sidebar">
          <div class="user-box">
            Olá, {{ user?.signInDetails?.loginId?.split('@')[0] }}
            <button @click="signOut" class="btn-small">Sair</button>
          </div>

          <div class="box">
            <h3>📝 Notas Rápidas</h3>
            <textarea v-model="currentNoteInput" placeholder="Escreva aqui..."></textarea>
            <button @click="addNote">Salvar Nota</button>
            <ul class="note-list">
              <li v-for="note in notes" :key="note.id">
                {{ note.content }} <span @click="deleteNote(note.id)" class="x-btn">×</span>
              </li>
            </ul>
          </div>

          <div class="box">
            <h3>📚 Matérias</h3>
            <input v-model="newSubjectName" placeholder="Nome da Matéria" />
            <div class="color-row">
              <input type="color" v-model="newSubjectColor" />
              <button @click="createSubject">Add</button>
            </div>
          </div>
        </aside>

        <main class="content">
          <header>
            <h2>Agenda de Estudos</h2>
            <div class="filters">
              <label>
                <input type="checkbox" v-model="showOnlyCurrentWeek"> Esta Semana
              </label>
              <select v-model="filterSubjectId">
                <option value="all">Todas</option>
                <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
          </header>

          <div class="new-act">
            <input type="date" v-model="newActivityDate" />
            <input v-model="newActivityTitle" placeholder="O que vamos estudar?" class="grow" />
            <select v-model="selectedSubjectId">
              <option value="" disabled>Selecione a Matéria</option>
              <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <button @click="createActivity">Agendar</button>
          </div>

          <div class="list">
            <div v-if="filteredActivities.length === 0" class="empty">Nada encontrado.</div>
            
            <div 
              v-for="act in filteredActivities" 
              :key="act.id" 
              class="card"
              :style="{ borderLeft: `5px solid ${subjects.find(s => s.id === act.subjectId)?.color || '#ccc'}` }"
            >
              <div class="date-box">
                {{ new Date(act.date).toLocaleDateString('pt-BR', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    timeZone: 'UTC' 
                }) }}
                  
                  <small>
                    {{ new Date(act.date).toLocaleDateString('pt-BR', { 
                        weekday: 'short', 
                        timeZone: 'UTC' 
                    }) }}
                  </small>
                </div>
              <div>
                <strong>{{ act.title }}</strong>
                <div class="sub-name">{{ subjects.find(s => s.id === act.subjectId)?.name || '...' }}</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </template>
  </authenticator>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 250px 1fr; height: 100vh; font-family: sans-serif; }
.sidebar { background: #f4f4f4; padding: 20px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid #ccc; }
.content { padding: 30px; overflow-y: auto; }
.box { background: white; padding: 10px; border-radius: 8px; border: 1px solid #ddd; }
.box h3 { margin-top: 0; font-size: 1em; }
.user-box { font-size: 0.9em; margin-bottom: 10px; }
.btn-small { background: #e74c3c; color: white; border: none; padding: 2px 5px; font-size: 0.8em; cursor: pointer; margin-left: 10px; }

/* Notas */
textarea { width: 100%; height: 60px; margin-bottom: 5px; resize: none; }
.note-list { list-style: none; padding: 0; margin: 10px 0 0 0; max-height: 150px; overflow-y: auto; }
.note-list li { background: #fff8b0; padding: 5px; margin-bottom: 5px; border-radius: 3px; display: flex; justify-content: space-between; font-size: 0.9em; }
.x-btn { cursor: pointer; color: red; font-weight: bold; }

/* Inputs e Botões Gerais */
input, select, button { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
button { background: #3498db; color: white; border: none; cursor: pointer; }
button:hover { background: #2980b9; }
.color-row { display: flex; gap: 5px; margin-top: 5px; }
.color-row button { flex-grow: 1; }

/* Main Area */
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.filters { display: flex; gap: 15px; align-items: center; }
.new-act { display: flex; gap: 10px; background: #eef2f3; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
.grow { flex-grow: 1; }

/* Cards */
.list { display: flex; flex-direction: column; gap: 10px; }
.card { background: white; padding: 10px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 15px; }
.date-box { display: flex; flex-direction: column; align-items: center; font-weight: bold; color: #555; min-width: 50px; }
.sub-name { font-size: 0.8em; color: #777; }
.empty { text-align: center; color: #999; margin-top: 20px; }
</style>