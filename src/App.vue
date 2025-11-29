<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { generateClient } from 'aws-amplify/data';
import { Authenticator } from '@aws-amplify/ui-vue';
import '@aws-amplify/ui-vue/styles.css';
import type { Schema } from '../amplify/data/resource';

const client = generateClient<Schema>();

// --- ESTADO ---
const subjects = ref<any[]>([]);
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
// async function createSubject() {
//   if (!newSubjectName.value) return;
//   const { data } = await client.models.Subject.create({
//     name: newSubjectName.value,
//     color: newSubjectColor.value
//   });
//   if (data) {
//     subjects.value.push(data);
//     newSubjectName.value = '';
//   }
// }

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

// --- LÓGICA DO POMODORO AVANÇADO ---
const showPomoModal = ref(false); // Abre/Fecha janela
const customMinutes = ref(25);    // Tempo no input (configurável)
const timerMinutes = ref(25);     // Minutos do relógio atual
const timerSeconds = ref(0);      // Segundos do relógio atual
const isTimerRunning = ref(false);
const timerInterval = ref<any>(null);
const pomodoroHistory = ref<any[]>([]); // Histórico vindo do banco

// --- 2. CONFIGURAÇÃO DA META DIÁRIA ---
const dailyGoalHours = ref(4);    // Começa com 4h padrão
const isEditingGoal = ref(false); // Mostra/Esconde input de edição

// Computada: Converte as horas da meta para minutos (ex: 4h -> 240min)
const dailyGoalMinutes = computed(() => {
  return dailyGoalHours.value * 60;
});

// Função: Salva a meta no navegador para não perder ao atualizar a página
function saveGoal() {
  localStorage.setItem('userStudyGoal', String(dailyGoalHours.value));
  isEditingGoal.value = false;
}

// --- 3. BANCO DE DADOS (Carregar) ---
async function loadPomodoros() {
  try {
    const { data } = await client.models.Pomodoro.list();
    // Ordena: Mais recentes primeiro
    pomodoroHistory.value = data.sort((a, b) => 
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  } catch (e) {
    console.error("Erro ao carregar pomodoros:", e);
  }
}

// --- 4. LÓGICA DO RELÓGIO (Start/Stop) ---
function toggleTimer() {
  if (isTimerRunning.value) {
    // PAUSAR
    clearInterval(timerInterval.value);
    isTimerRunning.value = false;
    return;
  }

  // INICIAR
  // Se o relógio estiver "zerado/intacto", garante que começa do tempo configurado
  if (timerMinutes.value === customMinutes.value && timerSeconds.value === 0) {
     timerMinutes.value = customMinutes.value;
  }

  isTimerRunning.value = true;
  timerInterval.value = setInterval(() => {
    if (timerSeconds.value > 0) {
      timerSeconds.value--;
    } else if (timerMinutes.value > 0) {
      timerMinutes.value--;
      timerSeconds.value = 59;
    } else {
      finishPomodoro(); // Acabou o tempo
    }
  }, 1000);
}

// --- 5. FINALIZAR E SALVAR (Create) ---
async function finishPomodoro() {
  clearInterval(timerInterval.value);
  isTimerRunning.value = false;
  
  // Tocar som (opcional) ou alerta
  alert("🎉 Foco concluído! Salvando progresso...");

  try {
    // Salva no DynamoDB
    const { data } = await client.models.Pomodoro.create({
      minutes: customMinutes.value, // Salva o tempo total que foi configurado
      completedAt: new Date().toISOString()
    });

    if (data) {
      pomodoroHistory.value.unshift(data); // Adiciona no topo da lista visual
    }
  } catch (e) {
    console.error("Erro ao salvar pomodoro:", e);
  }
  
  resetTimer();
}

// Reiniciar relógio
function resetTimer() {
  clearInterval(timerInterval.value);
  isTimerRunning.value = false;
  timerMinutes.value = customMinutes.value;
  timerSeconds.value = 0;
}

// --- 6. ESTATÍSTICAS (Computed) ---
const dailyProgress = computed(() => {
  const hoje = new Date().toDateString();
  
  // 1. Filtra histórico apenas de HOJE e soma os minutos
  const minutosHoje = pomodoroHistory.value
    .filter(p => new Date(p.completedAt).toDateString() === hoje)
    .reduce((total, p) => total + p.minutes, 0);

  // 2. Pega o valor total da meta (usando .value pois é computed)
  const metaTotal = dailyGoalMinutes.value; 

  // Evita divisão por zero
  if (metaTotal <= 0) return 0;

  // 3. Retorna porcentagem (limitada a 100%)
  return Math.min(Math.round((minutosHoje / metaTotal) * 100), 100);
});

// Formatação visual "00:00" para o HTML
const formattedTime = computed(() => {
  return `${String(timerMinutes.value).padStart(2,'0')}:${String(timerSeconds.value).padStart(2,'0')}`;
});

// --- 7. CICLO DE VIDA (OnMounted) ---
onMounted(() => {
  // Carrega dados gerais
  loadData(); 
  
  // Carrega histórico do Pomodoro
  loadPomodoros(); 
  
  // Recupera a meta salva no navegador (LocalStorage)
  const savedGoal = localStorage.getItem('userStudyGoal');
  if (savedGoal) {
    dailyGoalHours.value = parseFloat(savedGoal);
  }
});

// --- LÓGICA DO POMODORO ---------------------------------------

// --- LÓGICA DA CONTAGEM DE FALTAS ---------------------------------------
const newSubjectWorkload = ref('60'); // Padrão 60h

// Função auxiliar: Define o limite de faltas baseado nas horas
function getMaxAbsences(hours: number | null | undefined) {
  if (hours === 30) return 3;
  if (hours === 90) return 11;
  return 7; // Padrão para 60h ou indefinido
}

// Atualizar o createSubject para salvar a carga horária
async function createSubject() {
  if (!newSubjectName.value) return;
  
  const { data } = await client.models.Subject.create({
    name: newSubjectName.value,
    color: newSubjectColor.value,
    workload: parseInt(newSubjectWorkload.value), // Salva 30, 60 ou 90
    absences: 0 // Começa com zero
  });
  
  if (data) {
    subjects.value.push(data);
    newSubjectName.value = '';
  }
}

// NOVA FUNÇÃO: Atualizar Faltas (+ ou -)
async function updateAbsences(subject: any, change: number) {
  const current = subject.absences || 0;
  const newValue = current + change;
  
  if (newValue < 0) return; // Não permite faltas negativas

  // 1. Atualiza no Front (Visual imediato)
  subject.absences = newValue;

  // 2. Salva no Banco
  await client.models.Subject.update({
    id: subject.id,
    absences: newValue
  });
}
// --- LÓGICA DA CONTAGEM DE FALTAS ---------------------------------------
// --- LÓGICA Participantes ---------------------------------------
// --- DADOS DOS DESENVOLVEDORES  ---
const developers = [
  { 
    name: 'Hack the Cloud', 
    role: 'Mestres', 
    link: 'https://www.instagram.com/hackthecloud.unb', 
    photo: 's3://foto11/hack.PNG' 
  },
  { 
    name: 'Pablo Yuri', 
    role: 'Eng. Redes', 
    link: 'https://github.com/Pablo-Yuri', 
    photo: '/Fotos/PabloYuri.png' 
  },
  { 
    name: 'Victor Girão', 
    role: 'Eng. Computação', 
    link: 'https://www.linkedin.com/in/victor-gir%C3%A3o-costa-122a9b226/', 
    photo: 'https://photos.app.goo.gl/8YiabLFMdanZiuRa7' 
  },
  { 
    name: 'Thayná Gonçalves', 
    role: 'Fisioterapia', 
    link: 'https://www.linkedin.com/in/thaynagoncalvesdutra', 
    photo: 'https://photos.app.goo.gl/44NVufQcm7cFMcWJA' 
  },
  { 
    name: 'Igor Cardoso', 
    role: 'Computação', 
    link: 'https://www.linkedin.com/in/igorxcardoso/', 
    photo: 'https://photos.app.goo.gl/ckNSCzeBndfoh2Ra7' 
  },
  { 
    name: 'Participante 5', 
    role: 'Documentação', 
    link: '#', 
    photo: 'https://ui-avatars.com/api/?name=P+5&background=e74c3c&color=fff' 
  }
];

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
            
            <div class="subject-form">
              <input v-model="newSubjectName" placeholder="Nome (ex: Cálculo)" />
              
              <div class="row-inputs">
                <select v-model="newSubjectWorkload" title="Carga Horária">
                  <option value="30">30h</option>
                  <option value="60">60h</option>
                  <option value="90">90h</option>
                </select>
                
                <input type="color" v-model="newSubjectColor" title="Cor da Matéria" />
                <button @click="createSubject">Add</button>
              </div>
            </div>

            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">

            <div class="absences-list">
              <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;">⚠️ Controle de Faltas</h4>
              
              <div v-for="sub in subjects" :key="sub.id" class="absence-card">
                <div class="sub-header">
                  <span :style="{color: sub.color}">●</span> 
                  <strong>{{ sub.name }}</strong>
                </div>
                
                <div class="absence-controls">
                  <button @click="updateAbsences(sub, -1)" class="btn-count">-</button>
                  
                  <span :class="{ 'danger-text': (sub.absences || 0) >= getMaxAbsences(sub.workload) }">
                    {{ sub.absences || 0 }} / {{ getMaxAbsences(sub.workload) }} dias
                  </span>
                  
                  <button @click="updateAbsences(sub, 1)" class="btn-count">+</button>
                </div>

                <div class="progress-bar-bg">
                  <div 
                    class="progress-bar-fill"
                    :style="{ 
                      width: Math.min(((sub.absences || 0) / getMaxAbsences(sub.workload)) * 100, 100) + '%',
                      background: (sub.absences || 0) >= getMaxAbsences(sub.workload) ? '#e74c3c' : sub.color 
                    }"
                  ></div>
                </div>
              </div>
            </div>

          </div>
        <!-- <div class="box">
            <h3>Calendário Acadêmico 2025.2</h3>
            
            <div class="subject-form">
              {
                "initialData": "05/01/2026",
                "endDate": "14/02/2026",
                "description": "Período de de aulas"
              },
              {
                "initialData": "24/12/2025",
                "endDate": "29/12/2025",
                "description": "Período para solicitação de matrícula de 07h do dia 24/12/2025 até 23h59 do dia 29/12/2025 no SIGAA > Portal Discente > Ensino > Matrícula on-line > Realizar Matrícula em Turma de Férias."
              },
              {
                "initialData": "02/01/2026",
                "endDate": "05/01/2026",
                "description": "Matrícula Extraordinária em Turma de Férias de 10h do dia 02/01/2026 até 23h59 do dia 05/01/2026 no SIGAA > Portal Discente > Ensino > Matrícula on-line > Realizar Matrícula Extraordinária em Turma de Férias."
              },

              {
                "endDate": "24/01/2026",
                "description": "Trancamento parcial de matrícula (trancamento de disciplinas), mediante solicitação via peticionamento eletrônico para a SAA."
              }
            </div>
        </div> -->

            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
        </aside>
        <main class="content">
          <header>
            <h2>Agenda de Estudos</h2>
            <button @click="showPomoModal = true" class="btn-pomo-trigger">
              ⏱️ Modo Foco
            </button>
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
            <input v-model="newActivityTitle" placeholder="Assunto" class="grow" />
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
                    month: '2-digit',
                    day: '2-digit',  
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

          <div v-if="showPomoModal" class="modal-overlay">
          <div class="modal-box">
            <button class="close-btn" @click="showPomoModal = false">×</button>
            
            <h2>🧠 Sala de Foco</h2>

            <div class="timer-config" v-if="!isTimerRunning">
              <label>Tempo (min):</label>
              <input type="number" v-model="customMinutes" @change="resetTimer" min="1" max="120">
            </div>

            <div class="big-clock" :class="{ 'active': isTimerRunning }">
              {{ formattedTime }}
            </div>

            <div class="controls">
              <button @click="toggleTimer" class="btn-primary">
                {{ isTimerRunning ? '⏸️ PAUSAR' : '▶️ INICIAR' }}
              </button>
              <button @click="resetTimer" class="btn-secondary" title="Reiniciar">↺</button>
            </div>

            <hr class="divider">

            <div class="stats-area">
      
              <div class="progress-header">
                <span v-if="!isEditingGoal">
                  Meta: <strong>{{ dailyGoalHours }}h</strong>
                  <button class="btn-edit-goal" @click="isEditingGoal = true" title="Alterar meta">✏️</button>
                </span>

                <div v-else class="goal-editor">
                  <input 
                    type="number" 
                    v-model="dailyGoalHours" 
                    min="1" 
                    max="12" 
                    step="0.5"
                  > h
                  <button @click="saveGoal" class="btn-save-mini">OK</button>
                </div>

                <strong class="percent-text">{{ dailyProgress }}%</strong>
              </div>

              <div class="progress-bg">
                <div 
                  class="progress-fill" 
                  :style="{ 
                    width: dailyProgress + '%',
                    background: dailyProgress >= 100 ? '#f1c40f' : '#2ecc71' 
                  }"
                ></div>
              </div>
              
              <p style="font-size: 0.8em; color: #999; margin-top: 5px; text-align: center;">
                {{ (dailyGoalMinutes * (dailyProgress/100)).toFixed(0) }} min estudados de {{ dailyGoalMinutes }} min
              </p>
            </div>

            <div class="history-area">
              <h4>Últimos Focos</h4>
              <ul>
                <li v-for="p in pomodoroHistory.slice(0, 3)" :key="p.id">
                  <span>✅ {{ p.minutes }} min</span>
                  <small>{{ new Date(p.completedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) }}</small>
                </li>
              </ul>
            </div>

          </div>
        </div>

        <footer class="credits-footer">
            <p class="footer-title">Desenvolvido por:</p>
            
            <div class="devs-container">
              <a 
                v-for="(dev, index) in developers" 
                :key="index" 
                :href="dev.link" 
                target="_blank" 
                class="dev-card"
              >
                <img :src="dev.photo" class="dev-avatar" />
                <div class="dev-info">
                  <span class="dev-name">{{ dev.name }}</span>
                  <span class="dev-role">{{ dev.role }}</span>
                </div>
              </a>
            </div>
            
            <p class="copyright">© 2025 Agenda Acadêmica - Vue.js & AWS Amplify - Hack the Cloud</p>
          </footer>

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

/* --- POMODORO STYLES --- */
.pomodoro-bar {
  position: sticky; /* Gruda no fundo */
  bottom: 0;
  left: 0;
  right: 0;
  
  background: #2c3e50; /* Cor escura para destaque */
  color: white;
  
  display: flex;
  justify-content: space-between;
  align-items: center;
  
  padding: 10px 20px;
  margin-top: 20px;
  border-radius: 50px; /* Borda bem redonda */
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  z-index: 100;
  width: 90%;
  margin-left: auto;
  margin-right: auto;
  transition: background 0.3s;
}

/* Tema quando estiver em pausa (Verde) */
.pomodoro-bar.break-theme {
  background: #27ae60;
}

.timer-display {
  font-size: 2em;
  font-weight: bold;
  font-family: monospace; /* Fonte estilo relógio */
  letter-spacing: 2px;
}

/* Botões de Modo (Foco/Pausa) */
.pomo-controls {
  display: flex;
  gap: 5px;
}
.mode-btn {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.3);
  color: rgba(255,255,255,0.7);
  border-radius: 20px;
  padding: 5px 10px;
  font-size: 0.8em;
}
.mode-btn.active {
  background: white;
  color: #2c3e50; /* Texto escuro */
  font-weight: bold;
  border-color: white;
}

/* Botões de Ação (Play/Reset) */
.pomo-actions {
  display: flex;
  gap: 10px;
}
.action-btn {
  background: white;
  color: #2c3e50;
  font-weight: bold;
  border: none;
  padding: 8px 15px;
  border-radius: 20px;
}
.action-btn:hover {
  background: #ecf0f1;
}
.reset-btn {
  background: rgba(255,255,255,0.2);
  color: white;
  border: none;
  border-radius: 50%;
  width: 35px;
  height: 35px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.reset-btn:hover {
  background: rgba(255,255,255,0.4);
}

/* --- ESTILOS DO CONTROLE DE FALTAS --- */
.subject-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row-inputs {
  display: flex;
  gap: 5px;
}
.row-inputs select {
  width: 70px; /* Largura fixa para o seletor */
}
.row-inputs button {
  flex-grow: 1;
}

/* Lista de Faltas */
.absences-list {
  max-height: 250px;
  overflow-y: auto;
}
.absence-card {
  background: #f8f9fa;
  border: 1px solid #eee;
  padding: 8px;
  border-radius: 6px;
  margin-bottom: 8px;
}
.sub-header {
  font-size: 0.9em;
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.absence-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.85em;
  font-weight: bold;
  margin-bottom: 5px;
}
.btn-count {
  width: 25px;
  height: 25px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e0e0e0;
  color: #333;
  border-radius: 4px;
}
.btn-count:hover {
  background: #d6d6d6;
}

/* Texto de perigo quando estoura o limite */
.danger-text {
  color: #e74c3c;
  animation: pulse 1s infinite;
}

/* Barra de progresso */
.progress-bar-bg {
  width: 100%;
  height: 4px;
  background: #e0e0e0;
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  transition: width 0.3s ease, background 0.3s;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.6; }
  100% { opacity: 1; }
}

/* --- RODAPÉ --- */
.credits-footer {
  margin-top: 50px;
  padding-top: 20px;
  border-top: 1px solid #eee;
  text-align: center;
  color: #7f8c8d;
  padding-bottom: 80px; /* Espaço extra para não ficar atrás do Pomodoro se ele for fixo */
}

.footer-title {
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 15px;
}

.devs-container {
  display: flex;
  justify-content: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.dev-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  padding: 8px 15px;
  border-radius: 50px;
  text-decoration: none;
  color: #333;
  border: 1px solid #e0e0e0;
  transition: transform 0.2s, box-shadow 0.2s;
}

.dev-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
  border-color: #3498db;
}

.dev-avatar {
  width: 35px;
  height: 35px;
  border-radius: 50%;
  object-fit: cover;
}

.dev-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.1;
}

.dev-name {
  font-weight: bold;
  font-size: 0.9em;
}

.dev-role {
  font-size: 0.75em;
  color: #999;
}

.copyright {
  font-size: 0.75em;
  opacity: 0.6;
}

/* Botão que abre a janela */
.btn-pomo-trigger {
  background: #8e44ad;
  color: white;
  border: none;
  padding: 8px 15px;
  border-radius: 20px;
  cursor: pointer;
  font-weight: bold;
  box-shadow: 0 4px 0 #732d91;
  transition: transform 0.1s;
  margin-right: 15px; /* Espaço dos outros filtros */
}
.btn-pomo-trigger:active {
  transform: translateY(4px);
  box-shadow: none;
}

/* Fundo Escuro (Overlay) */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(44, 62, 80, 0.9); /* Azul escuro quase preto */
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

/* A Janela Branca */
.modal-box {
  background: white;
  padding: 30px;
  border-radius: 20px;
  width: 90%;
  max-width: 380px;
  text-align: center;
  position: relative;
  box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.close-btn {
  position: absolute;
  top: 15px; right: 15px;
  background: none; border: none;
  font-size: 1.5em; cursor: pointer; color: #999;
}

/* Relógio */
.big-clock {
  font-size: 4.5em;
  font-weight: bold;
  font-family: monospace;
  color: #2c3e50;
  margin: 10px 0;
}
.big-clock.active {
  color: #e74c3c; /* Vermelho quando rodando */
}

/* Inputs e Botões */
.timer-config input {
  font-size: 1.2em;
  width: 60px;
  text-align: center;
  margin-left: 10px;
  padding: 5px;
}

.controls {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 20px;
}

.btn-primary {
  background: #2c3e50;
  color: white;
  padding: 12px 30px;
  border-radius: 30px;
  font-size: 1.1em;
  border: none;
  cursor: pointer;
}

.btn-secondary {
  background: #ecf0f1;
  color: #333;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  font-size: 1.2em;
}

/* Barra de Progresso */
.stats-area {
  margin-top: 20px;
  text-align: left;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  font-size: 0.9em;
}
.progress-bg {
  background: #ecf0f1;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
}
.progress-fill {
  background: #2ecc71; /* Verde */
  height: 100%;
  transition: width 0.5s ease;
}

/* Histórico */
.history-area {
  margin-top: 20px;
  text-align: left;
}
.history-area h4 {
  font-size: 0.9em;
  color: #7f8c8d;
  margin-bottom: 10px;
}
.history-area ul {
  list-style: none;
  padding: 0;
}
.history-area li {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.9em;
}
.divider {
  border: 0;
  border-top: 1px solid #eee;
  margin: 20px 0;
}

/* Cabeçalho da Barra de Progresso */
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.95em;
  color: #2c3e50;
}

/* Botão Lápis */
.btn-edit-goal {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9em;
  opacity: 0.5;
  transition: opacity 0.2s;
}
.btn-edit-goal:hover {
  opacity: 1;
}

/* Editor de Meta (Input + Botão OK) */
.goal-editor {
  display: flex;
  align-items: center;
  gap: 5px;
}
.goal-editor input {
  width: 50px;
  padding: 2px 5px;
  border: 1px solid #3498db;
  border-radius: 4px;
  text-align: center;
}
.btn-save-mini {
  background: #27ae60;
  color: white;
  border: none;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  cursor: pointer;
}

.percent-text {
  color: #27ae60;
}
</style>