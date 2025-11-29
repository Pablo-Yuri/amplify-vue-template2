import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  // 1. Modelo de Matérias (ex: Matemática, Algoritmos)
  Subject: a.model({
    name: a.string().required(),
    color: a.string(), // Hex code (ex: #FF0000) para mostrar no calendário
    // Relacionamento: Uma matéria tem muitas atividades
    activities: a.hasMany('Activity'),
  })
  .authorization(allow => [allow.owner()]), // Cada usuário vê apenas suas matérias

  // 2. Modelo de Atividades (ex: Prova, Trabalho)
  Activity: a.model({
    title: a.string().required(),
    description: a.string(),
    date: a.date().required(), // Formato YYYY-MM-DD
    isCompleted: a.boolean().default(false),
    
    // Relacionamento com a Matéria
    subjectId: a.id(),
    subject: a.belongsTo('Subject'),
  })
  .authorization(allow => [allow.owner()])
  // Índice secundário para buscar atividades por data rapidamente (filtro de calendário)
  .secondaryIndexes((index) => [index('date')]),

  // 3. Modelo de Anotações Rápidas
  Note: a.model({
    content: a.string(),
  })
  .authorization(allow => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool', // Requer login (Cognito)
  },
});