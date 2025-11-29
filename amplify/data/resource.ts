/* amplify/data/resource.ts */
import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

const schema = a.schema({
  // ... Mantenha Subject, Activity e Note exatamente como estão ...
  Subject: a.model({
    name: a.string().required(),
    color: a.string(),
    workload: a.integer(),
    absences: a.integer().default(0),
    activities: a.hasMany('Activity', 'subjectId'), 
  }).authorization(allow => [allow.owner()]),

  Activity: a.model({
    title: a.string().required(),
    date: a.date().required(),
    subjectId: a.id(), 
    subject: a.belongsTo('Subject', 'subjectId'),
  }).authorization(allow => [allow.owner()]),

  Note: a.model({
    content: a.string(),
  }).authorization(allow => [allow.owner()]),

  // --- NOVA TABELA AQUI ---
  Pomodoro: a.model({
    minutes: a.integer().required(),      // Quanto tempo durou (ex: 25)
    completedAt: a.datetime().required(), // Data e hora do fim
  })
  .authorization(allow => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});