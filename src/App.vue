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
  // 1. Primeiro carrega do localStorage (dados locais)
  loadPomodorFromLocalStorage();

  try {
    // 2. Tenta carregar do banco (quando estiver disponível)
    const { data } = await client.models.Pomodoro.list();
    if (data && data.length > 0) {
      // Se conseguir do banco, mescla com localStorage (banco tem prioridade)
      const bankData = data.sort((a, b) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
      pomodoroHistory.value = bankData;
    }
  } catch (e) {
    console.error("Erro ao carregar pomodoros do banco:", e);
    // Continua com dados do localStorage se falhar
  }
}

// --- POMODORO LOCALSTORAGE ---
function loadPomodorFromLocalStorage() {
  const saved = localStorage.getItem('pomodoroHistory');
  if (saved) {
    try {
      const history = JSON.parse(saved);
      pomodoroHistory.value = history.sort((a: any, b: any) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
    } catch (e) {
      console.error("Erro ao carregar pomodoros do localStorage:", e);
    }
  }
}

function savePomodoroToLocalStorage(pomodoroData: any) {
  const current = pomodoroHistory.value || [];
  const updated = [pomodoroData, ...current];
  localStorage.setItem('pomodoroHistory', JSON.stringify(updated));
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

  // Dados do pomodoro
  const pomodoroData = {
    id: `pomo-${Date.now()}`, // Gerar ID local
    minutes: customMinutes.value,
    completedAt: new Date().toISOString()
  };

  // 1. Salva no localStorage (sempre funciona)
  savePomodoroToLocalStorage(pomodoroData);

  try {
    // 2. Tenta salvar no DynamoDB (quando banco estiver disponível)
    const { data } = await client.models.Pomodoro.create({
      minutes: customMinutes.value, // Salva o tempo total que foi configurado
      completedAt: new Date().toISOString()
    });

    if (data) {
      // Atualiza o histórico se conseguir salvar no banco
      pomodoroHistory.value.unshift(data);
    }
  } catch (e) {
    console.error("Erro ao salvar pomodoro no banco:", e);
    // Mesmo com erro no banco, continua funcionando com localStorage
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

  // Carrega atividades concluídas
  loadCompletedActivities();

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

// --- LÓGICA DE ABAS E ESTATÍSTICAS ---
const activeTab = ref('agenda'); // 'agenda', 'stats' ou 'activities'

// Rastrear atividades concluídas localmente
const completedActivities = ref<Set<string>>(new Set());

// Carregar atividades concluídas do localStorage
function loadCompletedActivities() {
  const saved = localStorage.getItem('completedActivities');
  if (saved) {
    completedActivities.value = new Set(JSON.parse(saved));
  }
}

// Salvar atividades concluídas no localStorage
function saveCompletedActivities() {
  localStorage.setItem('completedActivities', JSON.stringify(Array.from(completedActivities.value)));
}

// Computada para obter atividades agrupadas por matéria
const activitiesBySubject = computed(() => {
  const grouped: { [key: string]: { subject: any; activities: any[] } } = {};

  subjects.value.forEach(subject => {
    const subActivities = activities.value.filter(a => a.subjectId === subject.id);
    grouped[subject.id] = {
      subject,
      activities: subActivities.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    };
  });

  return grouped;
});

// Função para marcar atividade como completa
function toggleActivityComplete(activityId: string) {
  if (completedActivities.value.has(activityId)) {
    completedActivities.value.delete(activityId);
  } else {
    completedActivities.value.add(activityId);
  }
  saveCompletedActivities();
}

// Função para verificar se uma atividade está completa
function isActivityCompleted(activityId: string): boolean {
  return completedActivities.value.has(activityId);
}

// Computada para contar atividades pendentes por matéria
function getActivityStats(subjectId: string) {
  const subActivities = activities.value.filter(a => a.subjectId === subjectId);
  const completed = subActivities.filter(a => completedActivities.value.has(a.id)).length;
  const pending = subActivities.length - completed;

  return { completed, pending, total: subActivities.length };
}
const pomodoroByDay = computed(() => {
  const days: { [key: string]: number } = {};

  pomodoroHistory.value.forEach(p => {
    const date = new Date(p.completedAt).toLocaleDateString('pt-BR');
    days[date] = (days[date] || 0) + p.minutes;
  });

  return Object.entries(days)
    .map(([date, minutes]) => ({ date, minutes }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
});

// Computada para obter estatísticas por semana
const pomodoroByWeek = computed(() => {
  const weeks: { [key: string]: number } = {};

  pomodoroHistory.value.forEach(p => {
    const date = new Date(p.completedAt);
    const startOfWeek = new Date(date);
    startOfWeek.setDate(date.getDate() - date.getDay());

    const weekKey = `${startOfWeek.toLocaleDateString('pt-BR')} - ${new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR')}`;
    weeks[weekKey] = (weeks[weekKey] || 0) + p.minutes;
  });

  return Object.entries(weeks)
    .map(([week, minutes]) => ({ week, minutes }))
    .sort((a, b) => new Date(a.week).getTime() - new Date(b.week).getTime());
});

// Computada para obter total de minutos estudados
const totalMinutesStudied = computed(() => {
  return pomodoroHistory.value.reduce((total, p) => total + p.minutes, 0);
});

// Computada para obter média de minutos por sessão
const averageSessionMinutes = computed(() => {
  if (pomodoroHistory.value.length === 0) return 0;
  return Math.round(totalMinutesStudied.value / pomodoroHistory.value.length);
});

// --- LÓGICA DE ABAS E ESTATÍSTICAS ---
// --- LÓGICA Participantes ---------------------------------------
// --- DADOS DOS DESENVOLVEDORES  ---
const developers = [
  {
    name: 'Hack the Cloud',
    role: 'Mestres',
    link: 'https://www.instagram.com/hackthecloud.unb',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczOqxQZt4rkmST-LBMf5x3be8vye6x5PnrtWg1pX5dfrfUi6wQI0Bvz_eqLeIiaau4gEAgiXpSBOE9qpNioXSy2nYE00rhmRCGNB0he_gwSFZ881VorViHkp6PDMY9eMulBBRiHMdvUrw3F1ynHak1ObMg=w443-h432-s-no-gm?authuser=0'
  },
  {
    name: 'Pablo Yuri',
    role: 'Eng. Redes',
    link: 'https://github.com/Pablo-Yuri',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczP9mqYCcuHgwAcQKzcbmwBgz1m6ixORq8zjkbQpT1CKqovUPXbLNKJF-FXs8YaEeUgoWJhqdpVY4FgOeIpmTBt3_xep8-5SYZ3DJBkbFK6YrqqA6ruksLUNX7XaqeaDjs3hW-wNzOpEq0qmy-Dk4GJB3w=w449-h607-s-no-gm?authuser=0'
  },
  {
    name: 'Victor Girão',
    role: 'Eng. Comp',
    link: 'https://www.linkedin.com/in/victor-gir%C3%A3o-costa-122a9b226/',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczOmYxVVXCNuWr0FC-4GYXbdIbc486scuwvWSq6rNhyAfRv_1jaZMFDlS1BKkH7xy1XizL_utnDjQyjWGF7O5q2iGhp7psIa-a9QvBVVyAEJSr-WKeVg8-LM8OKkvl5eslp5L1HMj_Yau-Ke-o7IWMIQ_w=w454-h455-s-no-gm'
  },
  {
    name: 'Thayná Gonçalves',
    role: 'Fisioterapia',
    link: 'https://www.linkedin.com/in/thaynagoncalvesdutra',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczPpGB8uo2nkMuscpQDqV723i4mqyYst23WuRliwpyzBdYGMV0YSOnMkcVXhHG13IuQyfldsyMY6T1jvmv-GlqyKP7BjANUD-2tAUiq_s50rkGMr9LHwsG-UNkIVnpJ2wlv1UNxSwzBcv4f1tvV224DDxQ=w533-h650-s-no-gm'
  },
  {
    name: 'Igor Cardoso',
    role: 'Computação',
    link: 'https://www.linkedin.com/in/igorxcardoso/',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczMrBPO-3VQYmByLXlx8xbDbNIN65bo96uZVitVEip1BV1oq2MH3tbu_ZhNT_ZJrnjp8E5cmq4nsrzk0knEloZe6epILL1T4wJw5zEE0twXeyfr-obz9T08vWKPZgCSlATxTldt-esiTFrzvZ2NkP_AtJQ=w514-h577-s-no-gm?authuser=0'
  },
  {
    name: 'Ana Carolina Dias',
    role: 'Eng. Comp',
    link: 'https://linkedin.com/in/linadias',
    photo: 'https://lh3.googleusercontent.com/pw/AP1GczPc9UaZE4tTgOBKFNHP88-3xqAMxURQF_kCV1pVIHMELFWpYY0G5iuLRuqlVm6LZZ2IkG-QcKc5q__08yfzxHkf_qOle7AzWe_M4H5tiPnj3ym1xwuAZyvOvSICTl8m6PLwr8DPUqyikCpJTOZ2mxU2XQ=w455-h607-s-no-gm?authuser=0'
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

            <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
            <button @click="activeTab = 'stats'" class="btn-stats-link">📊 Estatísticas</button>

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
          <!-- Abas de Navegação -->
          <div class="tabs-container">
            <button
              @click="activeTab = 'agenda'"
              :class="{ 'tab-active': activeTab === 'agenda' }"
              class="tab-btn"
            >
              📋 Agenda
            </button>
            <button
              @click="activeTab = 'stats'"
              :class="{ 'tab-active': activeTab === 'stats' }"
              class="tab-btn"
            >
              📊 Estatísticas
            </button>
            <button
              @click="activeTab = 'activities'"
              :class="{ 'tab-active': activeTab === 'activities' }"
              class="tab-btn"
            >
              ✅ Atividades por Matéria
            </button>
          </div>

          <!-- ABA AGENDA -->
          <div v-show="activeTab === 'agenda'" class="tab-content">
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
          </div>

          <!-- ABA ESTATÍSTICAS -->
          <div v-show="activeTab === 'stats'" class="tab-content">
            <header>
              <h2>📊 Estatísticas de Estudo</h2>
            </header>

            <!-- Cards de Resumo -->
            <div class="stats-summary">
              <div class="stat-card">
                <div class="stat-label">Total Estudado</div>
                <div class="stat-value">{{ Math.floor(totalMinutesStudied / 60) }}h {{ totalMinutesStudied % 60 }}m</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Sessões Completas</div>
                <div class="stat-value">{{ pomodoroHistory.length }}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Média por Sessão</div>
                <div class="stat-value">{{ averageSessionMinutes }}m</div>
              </div>
            </div>

            <!-- Estatísticas por Dia -->
            <div class="stats-section">
              <h3>📅 Estatísticas por Dia</h3>
              <div v-if="pomodoroByDay.length === 0" class="empty-stats">
                Nenhuma sessão registrada ainda.
              </div>
              <div v-else class="stats-list">
                <div v-for="(day, index) in pomodoroByDay" :key="index" class="stat-item">
                  <div class="stat-date">{{ day.date }}</div>
                  <div class="stat-bar-container">
                    <div class="stat-bar" :style="{ width: Math.min((day.minutes / 120) * 100, 100) + '%' }"></div>
                  </div>
                  <div class="stat-time">{{ Math.floor(day.minutes / 60) }}h {{ day.minutes % 60 }}m</div>
                </div>
              </div>
            </div>

            <!-- Estatísticas por Semana -->
            <div class="stats-section">
              <h3>📆 Estatísticas por Semana</h3>
              <div v-if="pomodoroByWeek.length === 0" class="empty-stats">
                Nenhuma sessão registrada ainda.
              </div>
              <div v-else class="stats-list">
                <div v-for="(week, index) in pomodoroByWeek" :key="index" class="stat-item">
                  <div class="stat-date">{{ week.week }}</div>
                  <div class="stat-bar-container">
                    <div class="stat-bar" :style="{ width: Math.min((week.minutes / 500) * 100, 100) + '%' }"></div>
                  </div>
                  <div class="stat-time">{{ Math.floor(week.minutes / 60) }}h {{ week.minutes % 60 }}m</div>
                </div>
              </div>
            </div>
          </div>

          <!-- ABA ATIVIDADES POR MATÉRIA -->
          <div v-show="activeTab === 'activities'" class="tab-content">
            <header>
              <h2>✅ Atividades por Matéria</h2>
            </header>

            <div v-if="subjects.length === 0" class="empty-stats">
              Nenhuma matéria cadastrada. Crie uma matéria para começar!
            </div>

            <div v-else class="subjects-activities-list">
              <div
                v-for="(subjectData, subjectId) in activitiesBySubject"
                :key="subjectId"
                class="subject-section"
              >
                <!-- Cabeçalho da Matéria -->
                <div class="subject-header">
                  <div class="subject-title">
                    <span class="subject-dot" :style="{ background: subjectData.subject.color }"></span>
                    <h3>{{ subjectData.subject.name }}</h3>
                  </div>
                  <div class="subject-stats">
                    <span class="stat-badge completed">✅ {{ getActivityStats(subjectId).completed }}</span>
                    <span class="stat-badge pending">⏳ {{ getActivityStats(subjectId).pending }}</span>
                  </div>
                </div>

                <!-- Barra de Progresso -->
                <div class="progress-bar-container">
                  <div
                    class="progress-bar-fill"
                    :style="{
                      width: getActivityStats(subjectId).total === 0
                        ? '0%'
                        : ((getActivityStats(subjectId).completed / getActivityStats(subjectId).total) * 100) + '%',
                      background: subjectData.subject.color
                    }"
                  ></div>
                </div>

                <!-- Lista de Atividades -->
                <div class="activities-list">
                  <div v-if="subjectData.activities.length === 0" class="no-activities">
                    Nenhuma atividade cadastrada para esta matéria.
                  </div>

                  <!-- Atividades Pendentes -->
                  <div v-if="subjectData.activities.filter(a => !isActivityCompleted(a.id)).length > 0" class="activities-group">
                    <h4 class="activities-group-title">Pendentes</h4>
                    <div
                      v-for="activity in subjectData.activities.filter(a => !isActivityCompleted(a.id))"
                      :key="activity.id"
                      class="activity-item"
                    >
                      <div class="activity-checkbox">
                        <input
                          type="checkbox"
                          @change="toggleActivityComplete(activity.id)"
                          :id="`activity-${activity.id}`"
                        >
                      </div>
                      <div class="activity-details">
                        <label :for="`activity-${activity.id}`" class="activity-title">
                          {{ activity.title }}
                        </label>
                        <div class="activity-date">
                          {{ new Date(activity.date).toLocaleDateString('pt-BR', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                            timeZone: 'UTC'
                          }) }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Atividades Concluídas -->
                  <div v-if="subjectData.activities.filter(a => isActivityCompleted(a.id)).length > 0" class="activities-group">
                    <h4 class="activities-group-title completed-group">Concluídas</h4>
                    <div
                      v-for="activity in subjectData.activities.filter(a => isActivityCompleted(a.id))"
                      :key="activity.id"
                      class="activity-item completed"
                    >
                      <div class="activity-checkbox">
                        <input
                          type="checkbox"
                          checked
                          @change="toggleActivityComplete(activity.id)"
                          :id="`activity-${activity.id}`"
                        >
                      </div>
                      <div class="activity-details">
                        <label :for="`activity-${activity.id}`" class="activity-title">
                          {{ activity.title }}
                        </label>
                        <div class="activity-date">
                          {{ new Date(activity.date).toLocaleDateString('pt-BR', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                            timeZone: 'UTC'
                          }) }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Modal do Pomodoro -->
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
.sidebar { background: #f4f4f4; padding: 20px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid #ccc; overflow-y: auto; }
.content { padding: 30px; overflow-y: auto; display: flex; flex-direction: column; }
.box { background: white; padding: 10px; border-radius: 8px; border: 1px solid #ddd; }
.box h3 { margin-top: 0; font-size: 1em; }
.user-box { font-size: 0.9em; margin-bottom: 10px; }
.btn-small { background: #e74c3c; color: white; border: none; padding: 2px 5px; font-size: 0.8em; cursor: pointer; margin-left: 10px; font-weight: bold; }

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
header h2 { color: white; }
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
  background: #3498db;
  color: white;
  border-radius: 4px;
  font-weight: bold;
}
.btn-count:hover {
  background: #2980b9;
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
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid #eee;
  text-align: center;
  color: #7f8c8d;
  padding-bottom: 20px;
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
  min-width: 0;
}

.dev-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.05);
  border-color: #3498db;
}

.dev-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.dev-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.1;
  min-width: 0;
  flex-shrink: 1;
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

/* --- ESTILOS DAS ABAS --- */
.tabs-container {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 2px solid #eee;
}

.tab-btn {
  background: none;
  border: none;
  padding: 12px 20px;
  font-size: 1rem;
  cursor: pointer;
  color: #ffffff;
  border-bottom: 3px solid transparent;
  transition: all 0.3s ease;
}

.tab-btn:hover {
  color: #2c3e50;
}

.tab-btn.tab-active {
  color: #3498db;
  border-bottom-color: #3498db;
  background: rgba(52, 152, 219, 0.05);
}

.tab-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* --- ESTILOS DAS ESTATÍSTICAS --- */
.stats-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 30px;
}

.stat-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  box-shadow: 0 2px 5px rgba(0,0,0,0.05);
}

.stat-label {
  font-size: 0.85em;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
  color: #2c3e50;
}

.stats-section {
  margin-bottom: 30px;
}

.stats-section h3 {
  font-size: 1.1em;
  color: #2c3e50;
  margin-bottom: 15px;
}

.empty-stats {
  text-align: center;
  color: #999;
  padding: 30px;
  background: #f8f9fa;
  border-radius: 8px;
}

.stats-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.stat-item {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 15px;
  display: grid;
  grid-template-columns: 120px 1fr 80px;
  gap: 15px;
  align-items: center;
}

.stat-date {
  font-weight: bold;
  color: #2c3e50;
  font-size: 0.9em;
}

.stat-bar-container {
  background: #f0f0f0;
  border-radius: 4px;
  height: 30px;
  overflow: hidden;
}

.stat-bar {
  background: linear-gradient(90deg, #3498db, #2ecc71);
  height: 100%;
  display: flex;
  align-items: center;
  padding-left: 10px;
  font-size: 0.8em;
  color: white;
  font-weight: bold;
  transition: width 0.3s ease;
}

.stat-time {
  text-align: right;
  font-weight: bold;
  color: #2c3e50;
  font-size: 0.9em;
}

/* --- BOTÃO DE ESTATÍSTICAS --- */
.btn-stats-link {
  width: 100%;
  background: #3498db;
  color: white;
  border: none;
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: bold;
  transition: background 0.3s ease;
}

.btn-stats-link:hover {
  background: #2980b9;
}

/* --- ESTILOS DA ABA DE ATIVIDADES --- */
.subjects-activities-list {
  display: flex;
  flex-direction: column;
  gap: 25px;
}

.subject-section {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.subject-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.subject-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.subject-title h3 {
  margin: 0;
  font-size: 1.2em;
  color: #2c3e50;
}

.subject-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-block;
}

.subject-stats {
  display: flex;
  gap: 10px;
}

.stat-badge {
  font-size: 0.85em;
  padding: 6px 12px;
  border-radius: 20px;
  font-weight: bold;
}

.stat-badge.completed {
  background: #d4edda;
  color: #155724;
}

.stat-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  background: #e0e0e0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 20px;
}

.progress-bar-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.activities-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.no-activities {
  text-align: center;
  color: #999;
  padding: 20px;
  font-style: italic;
  background: #f8f9fa;
  border-radius: 6px;
}

.activities-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activities-group-title {
  font-size: 0.9em;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #ecf0f1;
}

.activities-group-title.completed-group {
  color: #27ae60;
}

.activity-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  align-items: flex-start;
  transition: background 0.2s ease;
}

.activity-item:hover {
  background: #eef2f3;
}

.activity-item.completed {
  background: #d4edda;
  opacity: 0.7;
}

.activity-item.completed:hover {
  background: #c3e6cb;
}

.activity-checkbox {
  padding-top: 2px;
}

.activity-checkbox input[type="checkbox"] {
  width: 20px;
  height: 20px;
  cursor: pointer;
  accent-color: #27ae60;
}

.activity-details {
  flex: 1;
  min-width: 0;
}

.activity-title {
  display: block;
  font-weight: 500;
  color: #2c3e50;
  margin-bottom: 4px;
  cursor: pointer;
  word-break: break-word;
}

.activity-item.completed .activity-title {
  text-decoration: line-through;
  color: #7f8c8d;
}

.activity-date {
  font-size: 0.8em;
  color: #95a5a6;
}
</style>