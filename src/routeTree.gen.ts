/* eslint-disable */
import { Route as rootRoute } from './routes/__root'
import { Route as IndexRoute } from './routes/index'
import { Route as ToolsIndexRoute } from './routes/tools/index'
import { Route as ToolsSlugRoute } from './routes/tools/$slug'
import { Route as ProfileRoute } from './routes/profile'
import { Route as ChatRoute } from './routes/chat'
import { Route as SettingsRoute } from './routes/settings'
import { Route as LogsRoute } from './routes/logs'
import { Route as MonitorsIndexRoute } from './routes/monitors/index'
import { Route as RunsIndexRoute } from './routes/runs/index'
import { Route as RunsIdRoute } from './routes/runs/$id'

export const routeTree = rootRoute.addChildren([
  IndexRoute,
  ProfileRoute,
  ChatRoute,
  SettingsRoute,
  LogsRoute,
  ToolsIndexRoute,
  ToolsSlugRoute,
  MonitorsIndexRoute,
  RunsIndexRoute,
  RunsIdRoute,
])
