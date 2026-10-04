import { verdict, type Scenario } from '../index';
import { goToLobby, press, ready, until } from '../shared/menu';

// The lobby's people button (FriendsButton, lan) opens the original Friends screen (ScreenName 24), which the original
// refused offline for lack of its remote config.
export const lobbyui: Scenario = {
  entry: 'menu',
  async run(context) {
    await until(context, 'start', ready, 20000);
    const lobby = await goToLobby(context);
    await context.screenshot('lobby');
    await press(context, [1025, 60]);
    const friends = await until(context, 'friends', menu => menu.screen === 24, 5000);
    await context.screenshot('friends');
    return verdict({ lobby, friends: friends.matched });
  },
};
