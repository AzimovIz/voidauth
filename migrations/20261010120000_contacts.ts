import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Verified contacts of a user (other than email, which stays on the user table)
  await knex.schema.createTable('user_contact', (table) => {
    table.uuid('id').primary().notNullable()
    table.uuid('userId').notNullable().references('id').inTable('user').onDelete('CASCADE')
    table.string('type', 32).notNullable()
    table.string('address').notNullable()
    table.string('displayName').nullable()
    table.timestamp('createdAt', { useTz: true }).notNullable()
    table.timestamp('updatedAt', { useTz: true }).notNullable()

    // one contact of each type per user, one user per contact address
    table.unique(['userId', 'type'])
    table.unique(['type', 'address'])
  })

  // Pending contact verifications (link tokens, codes)
  await knex.schema.createTable('contact_verification', (table) => {
    table.uuid('id').primary().notNullable()
    table.uuid('userId').notNullable().references('id').inTable('user').onDelete('CASCADE')
    table.string('type', 32).notNullable()
    table.string('address').nullable()
    table.string('challenge').notNullable()
    table.timestamp('expiresAt', { useTz: true }).notNullable()
    table.timestamp('createdAt', { useTz: true }).notNullable()

    table.unique(['type', 'challenge'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('contact_verification')
  await knex.schema.dropTable('user_contact')
}
