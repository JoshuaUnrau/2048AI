import random

class Observation_Space():
    def __init__(self,val):
        self.val = val
        self.shape = (val,)
    def sample(self):
        return random.randint(0,self.val)
    
class Env():
    def reset(self):
        self.box.clear()
        for i in range(self.x):
            for j in range(self.y):
                a = 0
                self.box.append(a)
        self.cpu_move()
        return self.box

    def __init__(self):
        self.box = []
        self.x = 2
        self.y = 2
        self.val = 2
        self.observation_space = Observation_Space(self.x*self.y)
        self.action_space = Observation_Space(4)
        self.reset()

    def index(self,_x, _y):
        return _y * self.y + _x

    def move(self,i, j, dir):
        try:
            if dir == 0:  # Right
                tile = self.box[self.index(self.x - 1 - i, j)]
                if tile != 0 and i != 0:
                    right = self.box[self.index(self.x - i, j)]
                    if right == tile or right == 0:
                        self.box[self.index(self.x - i, j)] += tile
                        self.box[self.index(self.x - 1 - i, j)] = 0
                        self.move(i - 1, j, dir)
            elif dir == 1:  # left
                tile = self.box[self.index(i, j)]
                if tile != 0 and i != 0:
                    left = self.box[self.index(i - 1, j)]
                    if left == tile or left == 0:
                        self.box[self.index(i - 1, j)] += tile
                        self.box[self.index(i, j)] = 0
                        self.move(i - 1, j, dir)
            elif dir == 2:  # Down
                tile = self.box[self.index(i, self.y - 1 - j)]
                if tile != 0 and j != 0:
                    right = self.box[self.index(i, self.y - j)]
                    if right == tile or right == 0:
                        self.box[self.index(i, self.y - j)] += tile
                        self.box[self.index(i, self.y - 1 - j)] = 0
                        self.move(i, j - 1, dir)
            elif dir == 3:  # Up
                tile = self.box[self.index(i, j)]
                if tile != 0 and j != 0:
                    up = self.box[self.index(i, j - 1)]
                    if up == tile or up == 0:
                        self.box[self.index(i, j - 1)] += tile
                        self.box[self.index(i, j)] = 0
                        self.move(i, j - 1, dir)
            return True
        except:
            return False

    def action_possible(self):
        test_box = self.box.copy()
        for k in range(3):
            for i in range(self.x):
                val = ""
                for j in range(self.y):
                    val += " " + str(self.box[(i * self.y + j)])
            for j in range(self.y):
                for i in range(self.x):
                    self.move(i, j, k)
            if test_box != self.box:
                self.box = test_box
                return True
        return False

    def cpu_move(self):
        for i in range(self.x * self.y - 1):
            if self.box[i] == 0:
                done = False
                while not done:
                    guess = random.randint(0, self.x * self.y - 1)
                    if self.box[guess] == 0:
                        self.box[guess] = 2
                        done = True
                break

    def step(self,entry):
        for i in range(self.x):
            val = ""
            for j in range(self.y):
                val += " " + str(self.box[(i * self.y + j)])
        for j in range(self.y):
            for i in range(self.x):
                self.move(i, j, entry)
        self.cpu_move()
        for i in range(self.x * self.y -1):
            if self.box[i] == 0:
                return self.box,1,False
        return self.box,1,self.action_possible()

def getInput():
    try:
        return int(input("Enter:")) - 1
    except:
        return getInput()

def printState():
    for i in range(env.x):
        val = ""
        for j in range(env.y):
            val += " "+str(env.box[(i * env.y + j)])
        print(val)
env = Env()
env.x = 3
env.y = 3
env.reset()
running = True
while running:
    printState()
    state,score,running = env.step(getInput())
